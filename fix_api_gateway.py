#!/usr/bin/env python3

"""
Fix indentation error in API Gateway's app.py
"""

import re

def fix_indentation():
    file_path = 'api_gateway/app.py'
    
    print(f"Opening file: {file_path}")
    with open(file_path, 'r') as f:
        content = f.read()
    
    print("Searching for indentation pattern...")
    search_pattern = r'    try:\n            resp = requests.request'
    replace_pattern = r'    try:\n        resp = requests.request'
    
    if search_pattern in content:
        print("Found indentation issue. Fixing...")
        fixed_content = content.replace(search_pattern, replace_pattern)
        
        with open(file_path, 'w') as f:
            f.write(fixed_content)
        
        print("API Gateway app.py has been fixed!")
        return True
    else:
        print("Indentation pattern not found. Looking for alternative pattern...")
        
        # Try another pattern
        search_pattern = r'try:\n            resp ='
        replace_pattern = r'try:\n        resp ='
        
        if search_pattern in content:
            print("Found alternative pattern. Fixing...")
            fixed_content = content.replace(search_pattern, replace_pattern)
            
            with open(file_path, 'w') as f:
                f.write(fixed_content)
            
            print("API Gateway app.py has been fixed (using alternative pattern)!")
            return True
    
    print("No indentation issue found or couldn't identify the pattern.")
    return False

if __name__ == "__main__":
    fix_indentation() 