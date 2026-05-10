"""Main UI window for Expense Tracker"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import threading
from pathlib import Path

from .tabs.document_upload import DocumentUploadTab
from .tabs.manual_entry import ManualEntryTab
from .tabs.bank_matching import BankMatchingTab
from .tabs.reports import ReportsTab
from .tabs.dashboard import DashboardTab


class MainWindow:
    """Main application window with tabbed interface"""

    def __init__(self, root, excel_handler, ocr_processor, bank_matcher, task_queue, result_queue):
        self.root = root
        self.excel_handler = excel_handler
        self.ocr_processor = ocr_processor
        self.bank_matcher = bank_matcher
        self.task_queue = task_queue
        self.result_queue = result_queue

        # Create notebook (tabbed interface)
        self.notebook = ttk.Notebook(root)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        # Create tabs
        self.dashboard_tab = DashboardTab(
            self.notebook,
            excel_handler,
            task_queue,
            result_queue
        )

        self.upload_tab = DocumentUploadTab(
            self.notebook,
            excel_handler,
            ocr_processor,
            task_queue,
            result_queue
        )

        self.entry_tab = ManualEntryTab(
            self.notebook,
            excel_handler,
            task_queue,
            result_queue
        )

        self.bank_tab = BankMatchingTab(
            self.notebook,
            excel_handler,
            bank_matcher,
            task_queue,
            result_queue
        )

        self.reports_tab = ReportsTab(
            self.notebook,
            excel_handler,
            task_queue,
            result_queue
        )

        # Add tabs to notebook
        self.notebook.add(self.dashboard_tab.frame, text="Dashboard")
        self.notebook.add(self.upload_tab.frame, text="Upload Documents")
        self.notebook.add(self.entry_tab.frame, text="Manual Entry")
        self.notebook.add(self.bank_tab.frame, text="Bank Matching")
        self.notebook.add(self.reports_tab.frame, text="Reports")

        # Status bar
        self._create_statusbar()

    def _create_statusbar(self):
        """Create status bar at bottom"""
        status_frame = ttk.Frame(self.root)
        status_frame.pack(side=tk.BOTTOM, fill=tk.X, padx=5, pady=5)

        self.status_label = ttk.Label(
            status_frame,
            text="Ready",
            relief=tk.SUNKEN
        )
        self.status_label.pack(side=tk.LEFT, expand=True, fill=tk.X)

        self.progress_var = tk.DoubleVar()
        self.progress = ttk.Progressbar(
            status_frame,
            variable=self.progress_var,
            maximum=100,
            mode='indeterminate'
        )
        self.progress.pack(side=tk.RIGHT, padx=(10, 0), width=200)

    def update_status(self, message: str):
        """Update status bar message"""
        self.root.after(0, lambda: self.status_label.config(text=message))

    def show_progress(self, show: bool = True):
        """Show/hide progress bar"""
        if show:
            self.progress.start()
        else:
            self.progress.stop()
