#!/usr/bin/env python3
"""
Telegram Bot File Uploader - Main Entry Point
A GUI application for uploading files to Telegram channels via bots.
"""

import sys
import os
import logging

# FIXED [MAIN-3]: Check if script directory is already in sys.path before inserting
script_dir = os.path.dirname(os.path.abspath(__file__))
if script_dir not in sys.path:
    sys.path.insert(0, script_dir)

from PyQt5.QtWidgets import QApplication, QMessageBox
from PyQt5.QtCore import Qt
from gui import MainWindow

def main():
    # FIXED [MAIN-4]: Configure logging at application startup
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        filename='uploader.log'
    )
    logger = logging.getLogger(__name__)
    logger.info("Application starting...")
    
    # FIXED [MAIN-1]: Wrap entire main() content in try-except for friendly error handling
    try:
        # FIXED [MAIN-2]: Check if QApplication already exists and handle display errors
        existing_app = QApplication.instance()
        if existing_app:
            app = existing_app
            logger.info("Using existing QApplication instance")
        else:
            try:
                # Enable high DPI scaling
                QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
                QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)
                
                app = QApplication(sys.argv)
                logger.info("QApplication created successfully")
            except RuntimeError as e:
                # Display error occurs (no X11/Wayland display on Linux, etc.)
                logger.error(f"Display error: {e}")
                print(f"Display error: {e}")
                print("Cannot create GUI - display not available")
                sys.exit(1)
        
        app.setApplicationName("File Uploader")
        app.setApplicationVersion("1.0.0")
        app.setOrganizationName("TelegramBotManager")
        
        # Set application style
        app.setStyle("Fusion")
        
        # Create and show main window
        window = MainWindow()
        window.show()
        
        logger.info("Main window displayed, entering event loop")
        sys.exit(app.exec_())
        
    except Exception as e:
        # FIXED [MAIN-1]: Catch any exceptions and show friendly error message
        logger.error(f"Startup error: {e}", exc_info=True)
        
        # Try to show GUI error message if possible
        try:
            from PyQt5.QtWidgets import QMessageBox
            QMessageBox.critical(
                None, 
                "Startup Error", 
                f"Failed to start application:\n\n{str(e)}\n\nCheck uploader.log for details."
            )
        except:
            # If GUI isn't available, print to console
            print(f"FATAL ERROR: Failed to start application")
            print(f"Error: {str(e)}")
            print(f"Check uploader.log for details")
        
        sys.exit(1)

if __name__ == "__main__":
    main()
