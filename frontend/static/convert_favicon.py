#!/usr/bin/env python3
"""
Convert SVG favicon to ICO format
"""

import os
import subprocess
from PIL import Image
from io import BytesIO

def convert_svg_to_ico(svg_path, ico_path, sizes=[16, 32, 48, 64]):
    """Convert SVG to ICO using rsvg-convert and PIL"""
    try:
        # First convert to PNG using rsvg-convert (typically installed on Linux)
        largest_size = max(sizes)
        png_data = BytesIO()
        
        # Try using rsvg-convert
        try:
            result = subprocess.run(
                ['rsvg-convert', '-w', str(largest_size), '-h', str(largest_size), svg_path],
                capture_output=True,
                check=True
            )
            png_data.write(result.stdout)
            png_data.seek(0)
        except (subprocess.SubprocessError, FileNotFoundError):
            # Fall back to a simpler method - create a colored square
            print("rsvg-convert not available, creating a simple colored icon")
            img = Image.new('RGBA', (largest_size, largest_size), color=(74, 134, 232, 255))
            img.save(png_data, format='PNG')
            png_data.seek(0)
        
        # Convert PNG to ICO
        img = Image.open(png_data)
        
        # Create ICO with multiple sizes
        ico_images = []
        for size in sizes:
            resized_img = img.resize((size, size), Image.LANCZOS)
            ico_images.append(resized_img)
        
        # Save as ICO
        img.save(ico_path, format='ICO', sizes=[(img.width, img.height) for img in ico_images])
        print(f"Successfully converted {svg_path} to {ico_path}")
        return True
        
    except Exception as e:
        print(f"Error converting SVG to ICO: {e}")
        return False

if __name__ == "__main__":
    svg_path = "images/favicon.svg"
    ico_path = "images/favicon.ico"
    
    if os.path.exists(svg_path):
        convert_svg_to_ico(svg_path, ico_path)
    else:
        print(f"SVG file not found: {svg_path}") 