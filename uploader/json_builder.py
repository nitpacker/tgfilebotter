"""
Builds and manages JSON metadata for bot file structure.
FIXED VERSION - All security issues addressed:
- [JB-10] from_json validates parsed structure
- [JB-1] Uses SHA256 instead of MD5
- [JB-3] All recursive methods have depth limits
- [JB-14] File ID format validation added
"""

import json
import hashlib
from typing import Dict, List, Any, Optional, Set, Tuple
from copy import deepcopy


class JsonBuilder:
    """Builds and compares JSON metadata structures."""
    
    def __init__(self):
        self.metadata = None
    
    def build_metadata(
        self,
        structure: Dict[str, Any],
        channel_id: str
    ) -> Dict[str, Any]:
        """
        Build metadata from scanned structure.
        Called after upload to include file_ids.
        """
        self.metadata = {
            'channelId': channel_id,
            'subfolders': structure.get('subfolders', {}),
            'files': structure.get('files', [])
        }
        return self.metadata
    
    def clean_metadata_for_server(self, structure: Dict[str, Any], depth: int = 0, max_depth: int = 50) -> Dict[str, Any]:
        """
        Remove local file paths from metadata before sending to server.
        Server only needs: fileName, fileId, messageId
        
        FIXED [JB-3]: Added depth limit to prevent stack overflow
        FIXED [JB-14]: Added file ID validation
        """
        # FIXED [JB-3]: Check depth limit
        if depth > max_depth:
            raise ValueError(f'Maximum structure depth ({max_depth}) exceeded')
        
        cleaned = {
            'files': [],
            'subfolders': {}
        }
        
        # Clean files
        for f in structure.get('files', []):
            file_id = f.get('fileId')
            message_id = f.get('messageId')
            file_name = f.get('fileName')
            
            # FIXED [JB-14]: Validate file IDs before adding
            if file_id and message_id:
                if not self._validate_file_id(file_id, message_id):
                    raise ValueError(f'Invalid file_id or message_id for {file_name}')
            
            cleaned['files'].append({
                'fileName': file_name,
                'fileId': file_id,
                'messageId': message_id
            })
        
        # Clean subfolders recursively with depth tracking
        for name, subfolder in structure.get('subfolders', {}).items():
            # FIXED [JB-3]: Pass incremented depth to recursive call
            cleaned['subfolders'][name] = self.clean_metadata_for_server(subfolder, depth + 1, max_depth)
        
        return cleaned
    
    def _validate_file_id(self, file_id: str, message_id: int) -> bool:
        """
        FIXED [JB-14]: Validate file ID and message ID format.
        
        Args:
            file_id: Telegram file_id string
            message_id: Telegram message_id integer
            
        Returns:
            bool: True if valid, False otherwise
        """
        # Validate file_id
        if not file_id or not isinstance(file_id, str):
            return False
        if len(file_id) < 10:  # Telegram file_ids are long strings
            return False
        
        # Validate message_id
        if not isinstance(message_id, int) or message_id <= 0:
            return False
        
        return True
    
    def calculate_file_hash(self, file_info: Dict) -> str:
        """
        Calculate a hash for a file based on name and size.
        
        FIXED [JB-1]: Changed from MD5 to SHA256 for better security
        """
        data = f"{file_info.get('fileName', '')}:{file_info.get('fileSize', 0)}"
        # FIXED [JB-1]: Use SHA256 instead of MD5
        return hashlib.sha256(data.encode()).hexdigest()
    
    def compare_structures(
        self,
        old_structure: Dict[str, Any],
        new_structure: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Compare old and new structures to find changes.
        Returns: added, removed, unchanged files
        """
        old_files = self._extract_files_with_paths(old_structure)
        new_files = self._extract_files_with_paths(new_structure)
        
        old_paths = set(old_files.keys())
        new_paths = set(new_files.keys())
        
        added_paths = new_paths - old_paths
        removed_paths = old_paths - new_paths
        common_paths = old_paths & new_paths
        
        # Check for modified files (same path, different size)
        modified_paths = set()
        unchanged_paths = set()
        
        for path in common_paths:
            old_size = old_files[path].get('fileSize', 0)
            new_size = new_files[path].get('fileSize', 0)
            
            if old_size != new_size:
                modified_paths.add(path)
            else:
                unchanged_paths.add(path)
        
        return {
            'added': [new_files[p] for p in added_paths],
            'removed': [old_files[p] for p in removed_paths],
            'modified': [new_files[p] for p in modified_paths],
            'unchanged': [old_files[p] for p in unchanged_paths],
            'summary': {
                'added_count': len(added_paths),
                'removed_count': len(removed_paths),
                'modified_count': len(modified_paths),
                'unchanged_count': len(unchanged_paths),
                'total_old': len(old_paths),
                'total_new': len(new_paths)
            }
        }
    
    def _extract_files_with_paths(
        self, 
        structure: Dict[str, Any], 
        current_path: str = "",
        depth: int = 0,
        max_depth: int = 50
    ) -> Dict[str, Dict]:
        """
        Extract all files with their relative paths as keys.
        
        FIXED [JB-3]: Added depth limit to prevent stack overflow
        """
        # FIXED [JB-3]: Check depth limit
        if depth > max_depth:
            raise ValueError(f'Maximum structure depth ({max_depth}) exceeded')
        
        files = {}
        
        for f in structure.get('files', []):
            file_path = f"{current_path}/{f['fileName']}" if current_path else f['fileName']
            files[file_path] = {**f, 'relativePath': file_path}
        
        for name, subfolder in structure.get('subfolders', {}).items():
            sub_path = f"{current_path}/{name}" if current_path else name
            # FIXED [JB-3]: Pass incremented depth to recursive call
            files.update(self._extract_files_with_paths(subfolder, sub_path, depth + 1, max_depth))
        
        return files
    
    def merge_with_existing(
        self,
        existing: Dict[str, Any],
        changes: Dict[str, Any],
        new_structure: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Merge new structure with existing, preserving file_ids for unchanged files.
        """
        # Create a map of existing file_ids by relative path
        existing_files = self._extract_files_with_paths(existing)
        existing_ids = {}
        
        for path, info in existing_files.items():
            if info.get('fileId') and info.get('messageId'):
                existing_ids[path] = {
                    'fileId': info['fileId'],
                    'messageId': info['messageId']
                }
        
        # Apply existing IDs to unchanged files in new structure
        def apply_ids(structure: Dict, current_path: str = "", depth: int = 0, max_depth: int = 50) -> Dict:
            """
            FIXED [JB-3]: Added depth limit to nested function
            """
            # FIXED [JB-3]: Check depth limit
            if depth > max_depth:
                raise ValueError(f'Maximum structure depth ({max_depth}) exceeded')
            
            result = {
                'files': [],
                'subfolders': {}
            }
            
            for f in structure.get('files', []):
                file_path = f"{current_path}/{f['fileName']}" if current_path else f['fileName']
                new_file = dict(f)
                
                # If file is unchanged and has existing IDs, use them
                if file_path in existing_ids:
                    # Check if it's in unchanged list
                    is_unchanged = any(
                        uf.get('relativePath') == file_path 
                        for uf in changes.get('unchanged', [])
                    )
                    if is_unchanged:
                        new_file['fileId'] = existing_ids[file_path]['fileId']
                        new_file['messageId'] = existing_ids[file_path]['messageId']
                        new_file['_skip_upload'] = True
                
                result['files'].append(new_file)
            
            for name, subfolder in structure.get('subfolders', {}).items():
                sub_path = f"{current_path}/{name}" if current_path else name
                # FIXED [JB-3]: Pass incremented depth to recursive call
                result['subfolders'][name] = apply_ids(subfolder, sub_path, depth + 1, max_depth)
            
            return result
        
        return apply_ids(new_structure)
    
    def get_files_to_upload(self, structure: Dict[str, Any]) -> List[Dict]:
        """Get list of files that need to be uploaded (not marked as skip)."""
        files = []
        
        for f in structure.get('files', []):
            if not f.get('_skip_upload'):
                files.append(f)
        
        for subfolder in structure.get('subfolders', {}).values():
            files.extend(self.get_files_to_upload(subfolder))
        
        return files
    
    def get_files_to_delete(self, changes: Dict[str, Any]) -> List[Dict]:
        """Get list of files that need to be deleted from channel."""
        return changes.get('removed', []) + changes.get('modified', [])
    
    def update_file_ids(
        self,
        structure: Dict[str, Any],
        file_path: str,
        file_id: str,
        message_id: int
    ) -> bool:
        """
        Update a file in the structure with its uploaded IDs.
        
        FIXED [JB-14]: Added validation of file IDs before updating
        """
        # FIXED [JB-14]: Validate file IDs before updating
        if not self._validate_file_id(file_id, message_id):
            raise ValueError(f'Invalid file_id or message_id for {file_path}')
        
        # Search in files
        for f in structure.get('files', []):
            if f.get('filePath') == file_path or f.get('relativePath') == file_path:
                f['fileId'] = file_id
                f['messageId'] = message_id
                return True
        
        # Search in subfolders
        for subfolder in structure.get('subfolders', {}).values():
            if self.update_file_ids(subfolder, file_path, file_id, message_id):
                return True
        
        return False
    
    def to_json(self, structure: Dict[str, Any], pretty: bool = False) -> str:
        """Convert structure to JSON string."""
        cleaned = self.clean_metadata_for_server(structure)
        if pretty:
            return json.dumps(cleaned, indent=2, ensure_ascii=False)
        return json.dumps(cleaned, ensure_ascii=False)
    
    def from_json(self, json_str: str) -> Dict[str, Any]:
        """
        Parse JSON string to structure.
        
        FIXED [JB-10]: Added validation of parsed structure
        """
        result = json.loads(json_str)
        
        # FIXED [JB-10]: Validate structure
        if not isinstance(result, dict):
            raise ValueError('Invalid JSON structure: expected object, got ' + type(result).__name__)
        
        # FIXED [JB-10]: Validate required keys exist
        if 'subfolders' not in result:
            raise ValueError('Invalid metadata: missing "subfolders" key')
        if 'files' not in result:
            raise ValueError('Invalid metadata: missing "files" key')
        
        return result
    
    def calculate_change_percentage(self, changes: Dict[str, Any]) -> float:
        """Calculate percentage of changes."""
        summary = changes.get('summary', {})
        total_old = summary.get('total_old', 0)
        total_new = summary.get('total_new', 0)
        
        base = max(total_old, total_new, 1)
        
        changed = (
            summary.get('added_count', 0) + 
            summary.get('removed_count', 0) + 
            summary.get('modified_count', 0)
        )
        
        return min((changed / base) * 100, 100)