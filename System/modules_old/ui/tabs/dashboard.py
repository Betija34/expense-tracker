"""Dashboard tab - summary and quick access"""

import tkinter as tk
from tkinter import ttk


class DashboardTab:
    """Dashboard showing month summary and quick statistics"""

    def __init__(self, parent, excel_handler, task_queue, result_queue):
        self.excel_handler = excel_handler
        self.task_queue = task_queue
        self.result_queue = result_queue

        self.frame = ttk.Frame(parent)
        self._create_ui()
        self.refresh_data()

    def _create_ui(self):
        """Create dashboard UI"""
        # Title
        title_label = ttk.Label(
            self.frame,
            text="Expense Tracking Dashboard",
            font=('Arial', 16, 'bold')
        )
        title_label.pack(pady=10)

        # Company selector
        company_frame = ttk.Frame(self.frame)
        company_frame.pack(pady=10)

        ttk.Label(company_frame, text="Select Company:").pack(side=tk.LEFT, padx=5)
        self.company_var = tk.StringVar(value='Rabona')
        company_combo = ttk.Combobox(
            company_frame,
            textvariable=self.company_var,
            values=['Rabona', 'Espargos'],
            state='readonly',
            width=15
        )
        company_combo.pack(side=tk.LEFT, padx=5)
        company_combo.bind('<<ComboboxSelected>>', lambda e: self.refresh_data())

        # Summary cards
        cards_frame = ttk.Frame(self.frame)
        cards_frame.pack(pady=20, padx=20, fill=tk.BOTH, expand=False)

        # Total Expenses Card
        self._create_card(cards_frame, "Total Expenses", "0.00 €", 0, 0)
        self.total_label = self._create_card(cards_frame, "Total Expenses", "0.00 €", 0, 0)

        # Complete Entries Card
        self.complete_label = self._create_card(cards_frame, "Complete Entries", "0", 0, 1)

        # Incomplete Entries Card
        self.incomplete_label = self._create_card(cards_frame, "Incomplete Entries", "0", 1, 0)

        # Month Selector
        month_frame = ttk.Frame(self.frame)
        month_frame.pack(pady=15)

        ttk.Label(month_frame, text="Current Month:").pack(side=tk.LEFT, padx=5)
        self.month_var = tk.StringVar(value='April 2026')
        month_combo = ttk.Combobox(
            month_frame,
            textvariable=self.month_var,
            values=[
                'January 2026', 'February 2026', 'March 2026', 'April 2026',
                'May 2026', 'June 2026', 'July 2026', 'August 2026',
                'September 2026', 'October 2026', 'November 2026', 'December 2026'
            ],
            state='readonly',
            width=15
        )
        month_combo.pack(side=tk.LEFT, padx=5)

        # Quick Action Buttons
        button_frame = ttk.Frame(self.frame)
        button_frame.pack(pady=20)

        ttk.Button(button_frame, text="Upload Document", width=20).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Add Manual Entry", width=20).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Match Bank Transactions", width=20).pack(side=tk.LEFT, padx=5)

    def _create_card(self, parent, title, value, row, col):
        """Create a summary card"""
        card = ttk.LabelFrame(parent, text=title, padding=15)
        card.grid(row=row, column=col, padx=10, pady=10, sticky='ew')
        card.columnconfigure(0, weight=1)

        value_label = ttk.Label(
            card,
            text=value,
            font=('Arial', 18, 'bold'),
            foreground='#2E7D32'
        )
        value_label.pack()

        return value_label

    def refresh_data(self):
        """Refresh dashboard with current data"""
        company = self.company_var.get()
        summary = self.excel_handler.get_month_summary(company)

        self.total_label.config(text=f"{summary.get('total_expenses', 0):.2f} €")
        self.complete_label.config(text=str(summary.get('complete_entries', 0)))
        self.incomplete_label.config(text=str(summary.get('incomplete_entries', 0)))
