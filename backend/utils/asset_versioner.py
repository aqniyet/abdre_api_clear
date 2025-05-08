"""
Asset Versioner Utility for ABDRE Chat Application
Handles versioning of static assets for cache busting
"""

import json
import logging
import os
import time
from datetime import datetime

logger = logging.getLogger(__name__)

class AssetVersioner:
    """Handles versioning of static assets for cache busting"""
    
    def __init__(self, static_folder, manifest_path=None):
        """
        Initialize the asset versioner
        
        Args:
            static_folder (str): Path to the static files folder
            manifest_path (str): Path to the manifest file (optional)
        """
        self.static_folder = static_folder
        self.manifest_path = manifest_path or os.path.join(static_folder, 'asset-manifest.json')
        self.versions = {}
        self.manifest_loaded = False
        
        # Try to load the manifest file if it exists
        self.load_manifest()
    
    def load_manifest(self):
        """
        Load asset versions from a manifest file
        
        Returns:
            bool: True if manifest was loaded successfully, False otherwise
        """
        if os.path.exists(self.manifest_path):
            try:
                with open(self.manifest_path, 'r') as f:
                    self.versions = json.load(f)
                self.manifest_loaded = True
                logger.info(f"Loaded asset manifest from {self.manifest_path}")
                return True
            except Exception as e:
                logger.error(f"Error loading asset manifest: {str(e)}")
        
        logger.warning(f"Asset manifest not found at {self.manifest_path}, using file modification times")
        return False
    
    def create_manifest(self):
        """
        Create a manifest file by scanning the static folder
        
        Returns:
            dict: Manifest dictionary with asset versions
        """
        manifest = {}
        
        for root, dirs, files in os.walk(self.static_folder):
            for file in files:
                if file.endswith(('.js', '.css', '.jpg', '.png', '.svg', '.ico')):
                    full_path = os.path.join(root, file)
                    relative_path = os.path.relpath(full_path, self.static_folder)
                    
                    # Use modification time as version
                    try:
                        mtime = os.path.getmtime(full_path)
                        manifest[relative_path] = str(int(mtime))
                    except Exception as e:
                        logger.error(f"Error getting modification time for {full_path}: {str(e)}")
                        # Use current time as fallback
                        manifest[relative_path] = str(int(time.time()))
        
        # Save the manifest
        try:
            with open(self.manifest_path, 'w') as f:
                json.dump(manifest, f, indent=2)
            logger.info(f"Created asset manifest at {self.manifest_path}")
        except Exception as e:
            logger.error(f"Error saving asset manifest: {str(e)}")
        
        self.versions = manifest
        self.manifest_loaded = True
        return manifest
    
    def get_version(self, asset_path):
        """
        Get the version for an asset
        
        Args:
            asset_path (str): Path to the asset, relative to static folder
            
        Returns:
            str: Version string
        """
        # Normalize path to use forward slashes
        asset_path = asset_path.replace('\\', '/')
        
        # If the path starts with /static/, remove it
        if asset_path.startswith('/static/'):
            asset_path = asset_path[8:]
        
        # Check if we have a version in the manifest
        if self.manifest_loaded and asset_path in self.versions:
            return self.versions[asset_path]
        
        # If not, use file modification time
        full_path = os.path.join(self.static_folder, asset_path)
        if os.path.exists(full_path):
            try:
                return str(int(os.path.getmtime(full_path)))
            except Exception:
                pass
        
        # Fallback to current time
        return str(int(time.time()))
    
    def versioned_url(self, asset_path):
        """
        Get a versioned URL for an asset
        
        Args:
            asset_path (str): Path to the asset, relative to static folder
            
        Returns:
            str: Versioned URL
        """
        version = self.get_version(asset_path)
        
        # Make sure asset_path starts with /static/
        if not asset_path.startswith('/static/'):
            asset_path = f"/static/{asset_path}"
        
        return f"{asset_path}?v={version}"

# Singleton instance
_instance = None

def get_asset_versioner(static_folder=None, manifest_path=None):
    """
    Get the singleton AssetVersioner instance
    
    Args:
        static_folder (str): Path to the static files folder
        manifest_path (str): Path to the manifest file (optional)
        
    Returns:
        AssetVersioner: Singleton instance
    """
    global _instance
    
    if _instance is None:
        if static_folder is None:
            static_folder = os.environ.get('STATIC_FOLDER', '../frontend/static')
        
        _instance = AssetVersioner(static_folder, manifest_path)
    
    return _instance 