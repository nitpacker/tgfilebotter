"""
Client for communicating with the backend server API.
Handles all HTTP communication with retry logic and proper error handling.
"""

import requests
import json
import time
from typing import Dict, Any, Optional
from functools import wraps
from config import API_UPLOAD, API_BOT_STATUS, API_TIMEOUT


def retry_with_backoff(max_retries=3, backoff_base=1):
    """
    Decorator to retry API calls with exponential backoff on transient failures.
    
    Args:
        max_retries: Maximum number of retry attempts (default: 3)
        backoff_base: Base delay in seconds for exponential backoff (default: 1)
    
    Retries on:
        - ConnectionError
        - Timeout
        - HTTP 502, 503 (server errors)
        - HTTP 429 (rate limit) - respects Retry-After header
    
    Does NOT retry on:
        - 4xx errors (except 429)
        - Successful responses
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            
            for attempt in range(1, max_retries + 1):
                try:
                    response = func(*args, **kwargs)
                    
                    # Check if response is a dict with error info (from our error handling)
                    if isinstance(response, dict):
                        # If it's a transient HTTP error, retry
                        if 'http_status' in response:
                            status_code = response['http_status']
                            
                            # Retry on 502, 503
                            if status_code in [502, 503] and attempt < max_retries:
                                wait_time = backoff_base * (2 ** (attempt - 1))
                                print(f"Retry {attempt}/{max_retries} after {wait_time}s delay (HTTP {status_code})")
                                time.sleep(wait_time)
                                continue
                            
                            # Handle 429 rate limit with Retry-After header
                            if status_code == 429 and attempt < max_retries:
                                retry_after = response.get('retry_after', backoff_base * (2 ** (attempt - 1)))
                                print(f"Retry {attempt}/{max_retries} after {retry_after}s delay (Rate Limited)")
                                time.sleep(retry_after)
                                continue
                    
                    # Success or non-retryable error
                    return response
                    
                except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
                    last_exception = e
                    if attempt < max_retries:
                        wait_time = backoff_base * (2 ** (attempt - 1))
                        print(f"Retry {attempt}/{max_retries} after {wait_time}s delay")
                        time.sleep(wait_time)
                    else:
                        # Max retries reached
                        if isinstance(e, requests.exceptions.ConnectionError):
                            return {'connected': False, 'error': 'Connection failed after retries'}
                        else:
                            return {'connected': False, 'error': 'Connection timed out after retries'}
                
                except Exception as e:
                    # Don't retry on unexpected exceptions
                    print(f"Unexpected error in {func.__name__}: {str(e)}")
                    return {'success': False, 'error': f'Unexpected error: {str(e)}'}
            
            # Should not reach here, but handle it
            if last_exception:
                return {'success': False, 'error': f'Failed after {max_retries} retries: {str(last_exception)}'}
            
            return {'success': False, 'error': 'Max retries exceeded'}
        
        return wrapper
    return decorator


class APIClient:
    """Handles all communication with the backend server."""
    
    def __init__(self, server_url: str = None):
        if server_url:
            # Parse base URL properly
            self.base_url = server_url.rsplit('/api/', 1)[0] if '/api/' in server_url else server_url
            self.upload_url = f"{self.base_url}/api/upload"
            self.status_url = f"{self.base_url}/api/bot-status"
            self.metadata_url = f"{self.base_url}/api/bot-metadata"
        else:
            # Use config defaults
            self.base_url = API_UPLOAD.rsplit('/api/', 1)[0] if '/api/' in API_UPLOAD else API_UPLOAD.rsplit('/', 1)[0]
            self.upload_url = API_UPLOAD
            self.status_url = API_BOT_STATUS
            self.metadata_url = f"{self.base_url}/api/bot-metadata"
        
        # Create session for connection pooling
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'TelegramBotUploader/1.0'
        })
    
    @retry_with_backoff(max_retries=3, backoff_base=1)
    def check_connection(self) -> Dict[str, Any]:
        """Check if server is reachable."""
        try:
            # Try health endpoint
            resp = self.session.get(
                f"{self.base_url}/health",
                timeout=5
            )
            
            # Validate Content-Type before parsing JSON
            content_type = resp.headers.get('content-type', '')
            if not content_type.startswith('application/json'):
                return {
                    'connected': False,
                    'error': f'Unexpected response type: {content_type}. Server may have returned an error page.'
                }
            
            if resp.status_code == 200:
                return {'connected': True, 'status': 'Server online'}
            else:
                return {
                    'connected': False, 
                    'error': f'Server returned status {resp.status_code}',
                    'http_status': resp.status_code
                }
                
        except requests.exceptions.ConnectionError:
            return {'connected': False, 'error': 'Cannot connect to server'}
        except requests.exceptions.Timeout:
            return {'connected': False, 'error': 'Connection timed out'}
        except Exception as e:
            return {'connected': False, 'error': str(e)}
    
    @retry_with_backoff(max_retries=3, backoff_base=1)
    def get_bot_status(self, bot_token: str) -> Dict[str, Any]:
        """
        Get existing bot status and metadata from server.
        Used for update mode to compare with local files.
        """
        try:
            resp = self.session.get(
                f"{self.status_url}/{bot_token}",
                timeout=API_TIMEOUT
            )
            
            # Validate Content-Type before parsing JSON
            content_type = resp.headers.get('content-type', '')
            if not content_type.startswith('application/json'):
                return {
                    'exists': False,
                    'error': f'Unexpected response type: {content_type}. Server may have returned an error page.'
                }
            
            data = resp.json()
            
            if resp.status_code == 404:
                return {
                    'exists': False,
                    'error': 'Bot not found on server'
                }
            
            # Handle rate limiting
            if resp.status_code == 429:
                retry_after = resp.headers.get('Retry-After')
                if retry_after:
                    try:
                        retry_after = int(retry_after)
                    except ValueError:
                        retry_after = 60
                else:
                    retry_after = 60
                
                return {
                    'exists': False,
                    'error': f'Rate limited. Retry after {retry_after}s',
                    'http_status': 429,
                    'retry_after': retry_after
                }
            
            # Handle server errors (502, 503) - will be retried by decorator
            if resp.status_code in [502, 503]:
                return {
                    'exists': False,
                    'error': f'Server error {resp.status_code}',
                    'http_status': resp.status_code
                }
            
            if data.get('success'):
                return {
                    'exists': True,
                    'status': data.get('status'),
                    'botId': data.get('botId'),
                    'botUsername': data.get('botUsername'),
                    'ownerRegistered': data.get('ownerRegistered'),
                    'metadata': data.get('metadata')
                }
            else:
                return {
                    'exists': False,
                    'error': data.get('error', 'Unknown error')
                }
                
        except requests.exceptions.RequestException as e:
            return {'exists': False, 'error': f'Connection error: {str(e)}'}
        except json.JSONDecodeError:
            return {'exists': False, 'error': 'Invalid response from server'}
    
    @retry_with_backoff(max_retries=3, backoff_base=1)
    def get_bot_metadata(self, bot_token: str) -> Optional[Dict[str, Any]]:
        """
        Get full bot metadata from server for comparison.
        This endpoint needs to exist on server for update mode.
        """
        try:
            resp = self.session.get(
                f"{self.metadata_url}/{bot_token}",
                timeout=API_TIMEOUT
            )
            
            # Validate Content-Type before parsing JSON
            content_type = resp.headers.get('content-type', '')
            if not content_type.startswith('application/json'):
                print(f"Unexpected response type: {content_type}")
                return None
            
            if resp.status_code == 200:
                data = resp.json()
                if data.get('success'):
                    return data.get('metadata')
            
            # Handle rate limiting
            if resp.status_code == 429:
                retry_after = resp.headers.get('Retry-After')
                if retry_after:
                    try:
                        retry_after = int(retry_after)
                    except ValueError:
                        retry_after = 60
                else:
                    retry_after = 60
                
                # Return error dict for retry logic
                return {
                    '_error': True,
                    'http_status': 429,
                    'retry_after': retry_after
                }
            
            # Handle server errors (502, 503) - will be retried by decorator
            if resp.status_code in [502, 503]:
                return {
                    '_error': True,
                    'http_status': resp.status_code
                }
            
            return None
            
        except:
            return None
    
    @retry_with_backoff(max_retries=3, backoff_base=1)
    def upload_metadata(
        self,
        bot_token: str,
        channel_id: str,
        bot_username: str,
        metadata: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Upload bot metadata to the server.
        This is called after all files are uploaded to Telegram.
        """
        try:
            payload = {
                'botToken': bot_token,
                'channelId': channel_id,
                'botUsername': bot_username,
                'metadata': metadata
            }
            
            # Check payload size BEFORE sending request
            payload_json = json.dumps(payload)
            payload_size = len(payload_json.encode('utf-8'))
            
            # Maximum JSON size (10MB default, configurable on server)
            MAX_JSON_SIZE = 10 * 1024 * 1024
            
            if payload_size > MAX_JSON_SIZE:
                return {
                    'success': False,
                    'error': f'Metadata too large ({payload_size/1024/1024:.2f}MB). Maximum: {MAX_JSON_SIZE/1024/1024}MB'
                }
            
            resp = self.session.post(
                self.upload_url,
                json=payload,
                headers={'Content-Type': 'application/json'},
                timeout=API_TIMEOUT
            )
            
            # Validate Content-Type before parsing JSON
            content_type = resp.headers.get('content-type', '')
            if not content_type.startswith('application/json'):
                return {
                    'success': False,
                    'error': f'Unexpected response type: {content_type}. Server may have returned an error page.'
                }
            
            data = resp.json()
            
            if resp.status_code == 413:
                return {
                    'success': False,
                    'error': f"Metadata too large ({payload_size / 1024 / 1024:.2f}MB). Reduce folder structure."
                }
            
            # Handle rate limiting with Retry-After header
            if resp.status_code == 429:
                retry_after = resp.headers.get('Retry-After')
                if retry_after:
                    try:
                        retry_after = int(retry_after)
                    except ValueError:
                        retry_after = 60
                else:
                    retry_after = 60
                
                return {
                    'success': False,
                    'error': f'Rate limited. Retry after {retry_after}s',
                    'http_status': 429,
                    'retry_after': retry_after
                }
            
            # Handle server errors (502, 503) - will be retried by decorator
            if resp.status_code in [502, 503]:
                return {
                    'success': False,
                    'error': f'Server error {resp.status_code}',
                    'http_status': resp.status_code
                }
            
            if data.get('success'):
                return {
                    'success': True,
                    'botId': data.get('botId'),
                    'status': data.get('status'),
                    'message': data.get('message'),
                    'isUpdate': data.get('isUpdate', False),
                    'changePercentage': data.get('changePercentage')
                }
            else:
                return {
                    'success': False,
                    'error': data.get('error', 'Upload failed'),
                    'details': data.get('details')
                }
                
        except requests.exceptions.ConnectionError:
            return {'success': False, 'error': 'Cannot connect to server'}
        except requests.exceptions.Timeout:
            return {'success': False, 'error': 'Server request timed out'}
        except json.JSONDecodeError:
            return {'success': False, 'error': 'Invalid response from server'}
        except Exception as e:
            return {'success': False, 'error': f'Error: {str(e)}'}
    
    def validate_server_response(self, response: Dict) -> bool:
        """Validate that server response has expected format."""
        if not isinstance(response, dict):
            return False
        return 'success' in response or 'error' in response
    
    def close(self):
        """Close the session and cleanup resources."""
        if hasattr(self, 'session'):
            self.session.close()
    
    def __enter__(self):
        """Context manager entry."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - ensures cleanup."""
        self.close()
        return False
    
    def __del__(self):
        """Destructor - cleanup session if not already closed."""
        try:
            self.close()
        except:
            pass
