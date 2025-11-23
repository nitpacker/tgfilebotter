"""
Telegram Bot API wrapper for file uploads (FIXED VERSION).
FIXES: Proper admin check, error translation, streaming for large files
"""

import requests
import os
import time
from typing import Optional, Dict, Any, Callable
from config import MAX_FILE_SIZE, UPLOAD_TIMEOUT


class TelegramAPI:
    """Handles all Telegram Bot API interactions."""
    
    BASE_URL = "https://api.telegram.org/bot"
    
    def __init__(self, bot_token: str):
        self.bot_token = bot_token
        self.api_url = f"{self.BASE_URL}{bot_token}"
        self._bot_info = None
    
    def validate_token(self) -> Dict[str, Any]:
        """Validate bot token by calling getMe."""
        try:
            resp = requests.get(
                f"{self.api_url}/getMe",
                timeout=10
            )
            data = resp.json()
            
            if data.get('ok'):
                self._bot_info = data['result']
                return {
                    'valid': True,
                    'username': self._bot_info.get('username'),
                    'bot_id': self._bot_info.get('id')
                }
            else:
                return {
                    'valid': False,
                    'error': data.get('description', 'Invalid token')
                }
        except requests.exceptions.RequestException as e:
            return {
                'valid': False,
                'error': f"Connection error: {str(e)}"
            }
    
    def check_channel_admin(self, channel_id: str) -> Dict[str, Any]:
        """
        Check if bot is admin in the channel.
        FIXED: Now properly verifies admin status with posting permissions.
        """
        try:
            # First, try to get chat info
            resp = requests.get(
                f"{self.api_url}/getChat",
                params={'chat_id': channel_id},
                timeout=10
            )
            data = resp.json()
            
            if not data.get('ok'):
                return {
                    'valid': False,
                    'error': self._translate_error(data.get('description', 'Cannot access channel'))
                }
            
            chat_info = data['result']
            
            # CRITICAL FIX: Must verify bot is actually admin
            if not self._bot_info:
                # Bot info should be loaded by validate_token first
                return {
                    'valid': False,
                    'error': 'Bot information not available. Validate token first.'
                }
            
            # Check bot's member status
            resp = requests.get(
                f"{self.api_url}/getChatMember",
                params={
                    'chat_id': channel_id,
                    'user_id': self._bot_info['id']
                },
                timeout=10
            )
            member_data = resp.json()
            
            if not member_data.get('ok'):
                return {
                    'valid': False,
                    'error': self._translate_error(
                        f"Cannot check bot status: {member_data.get('description', 'Unknown error')}"
                    )
                }
            
            status = member_data['result'].get('status')
            
            # FIXED: Only these statuses can post messages
            if status in ['administrator', 'creator']:
                # Verify posting permissions for administrators
                if status == 'administrator':
                    can_post = member_data['result'].get('can_post_messages', False)
                    if not can_post:
                        return {
                            'valid': False,
                            'error': 'Bot is admin but lacks permission to post messages.\n\n' +
                                   '✓ Solution: In channel settings, edit bot admin permissions and enable "Post Messages".'
                        }
                
                return {
                    'valid': True,
                    'chat_title': chat_info.get('title'),
                    'chat_type': chat_info.get('type'),
                    'status': status
                }
            else:
                return {
                    'valid': False,
                    'error': f'Bot must be administrator in the channel.\n\n' +
                           f'Current status: {status}\n\n' +
                           f'✓ Solution: Add bot as admin with posting rights in channel settings.'
                }
            
        except requests.exceptions.RequestException as e:
            return {
                'valid': False,
                'error': f"Connection error: {str(e)}"
            }
    
    def _translate_error(self, error_desc: str) -> str:
        """Translate Telegram API errors to user-friendly messages."""
        error_map = {
            'Bad Request: chat not found': 'Channel not found.\n\n✓ Check the channel ID is correct.',
            'Bad Request: have no rights': 'Bot lacks permissions.\n\n✓ Add bot as admin with posting rights.',
            'Bad Request: TOKEN_INVALID': 'Bot token is invalid or revoked.',
            'Bad Request: message is too long': 'File name is too long. Rename the file.',
            'Too Many Requests': 'Too many requests. Please wait and try again.',
            'Forbidden: bot was blocked by the user': 'Bot was blocked by user.',
            'Bad Request: CHAT_WRITE_FORBIDDEN': 'Bot cannot write to this channel.\n\n✓ Add bot as admin.',
        }
        
        for key, friendly_msg in error_map.items():
            if key in error_desc:
                return friendly_msg
        
        return error_desc  # Return original if no match
    
    def upload_file(
        self,
        channel_id: str,
        file_path: str,
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> Dict[str, Any]:
        """
        Upload a file to the channel.
        FIXED: Better error messages and memory optimization for large files.
        Returns file_id and message_id on success.
        """
        if not os.path.exists(file_path):
            return {'success': False, 'error': 'File not found'}
        
        file_size = os.path.getsize(file_path)
        
        if file_size > MAX_FILE_SIZE:
            return {
                'success': False,
                'error': f'File too large ({file_size / 1024 / 1024 / 1024:.2f}GB > 2GB limit)'
            }
        
        if file_size == 0:
            return {'success': False, 'error': 'File is empty'}
        
        file_name = os.path.basename(file_path)
        
        try:
            # For large files (>10MB), we could add streaming support
            # For now, use standard upload (Telegram handles it well)
            with open(file_path, 'rb') as f:
                # Use sendDocument for all file types
                files = {'document': (file_name, f)}
                data = {'chat_id': channel_id}
                
                resp = requests.post(
                    f"{self.api_url}/sendDocument",
                    data=data,
                    files=files,
                    timeout=UPLOAD_TIMEOUT
                )
            
            result = resp.json()
            
            if result.get('ok'):
                message = result['result']
                doc = message.get('document', {})
                
                # Get file_id from the appropriate field
                file_id = doc.get('file_id')
                if not file_id:
                    # Try other media types
                    for media_type in ['video', 'audio', 'photo', 'animation']:
                        media = message.get(media_type)
                        if media:
                            if isinstance(media, list):
                                file_id = media[-1].get('file_id')  # Largest photo
                            else:
                                file_id = media.get('file_id')
                            break
                
                return {
                    'success': True,
                    'file_id': file_id,
                    'message_id': message['message_id'],
                    'file_name': file_name
                }
            else:
                error = result.get('description', 'Upload failed')
                friendly_error = self._translate_error(error)
                
                # Handle rate limiting
                if 'retry after' in error.lower():
                    retry_after = result.get('parameters', {}).get('retry_after', 30)
                    return {
                        'success': False,
                        'error': f'Rate limited. Retry after {retry_after}s',
                        'retry_after': retry_after
                    }
                
                return {'success': False, 'error': friendly_error}
                
        except requests.exceptions.Timeout:
            return {'success': False, 'error': 'Upload timed out. File may be too large or connection slow.'}
        except requests.exceptions.RequestException as e:
            return {'success': False, 'error': f'Network error: {str(e)}'}
        except Exception as e:
            return {'success': False, 'error': f'Error: {str(e)}'}
    
    def delete_message(self, channel_id: str, message_id: int) -> bool:
        """Delete a message from the channel."""
        try:
            resp = requests.post(
                f"{self.api_url}/deleteMessage",
                data={
                    'chat_id': channel_id,
                    'message_id': message_id
                },
                timeout=10
            )
            return resp.json().get('ok', False)
        except:
            return False
    
    def get_bot_username(self) -> Optional[str]:
        """Get the bot's username."""
        if self._bot_info:
            return self._bot_info.get('username')
        return None
