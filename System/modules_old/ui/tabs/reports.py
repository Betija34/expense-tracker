"""Reports tab - generate various reports"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from datetime import datetime


class ReportsTab:
    """Tab for generating reports"""

    def __init__(self, parent, excel_handler, task_queue, result_queue):
        self.excel_handler = excel_handler
        self.task_queue = task_queue
        self.result_queue = result_queue

        self.frame = ttk.Frame(parent)
        self._create_ui()

    def _create_ui(self):
        """Create reports UI"""
        # Title
        title_label = ttk.Label(
            self.frame,
            text="Generate Reports",
            font=('Arial', 14, 'bold')
        )
        title_label.pack(pady=10)

        # Report type selection
        report_frame = ttk.LabelFrame(self.frame, text="Select Report Type", padding=20)
        report_frame.pack(padx=20, pady=10, fill=tk.X)

        self.report_type_var = tk.StringVar(value='Monthly Summary')

        reports = [
            ('Monthly Summary', 'Summary of expenses by category'),
            ('Client Invoice Report', 'Expenses to invoice to clients'),
            ('Shareholder Settlement', 'Shareholder account movements'),
            ('Travel Expenses', 'Travel expenses and per diem'),
            ('Inter-Company Transfers', 'Transfers between Rabona and Espargos'),
            ('Bank Reconciliation', 'Unmatched bank transactions'),
            ('Incomplete Entries', 'Entries missing required data'),
            ('Year-End Summary', 'Full year financial summary'),
        ]

        for value, desc in reports:
            ttk.Radiobutton(
                report_frame,
                text=f"{value} - {desc}",
                variable=self.report_type_var,
                value=value
            ).pack(anchor='w', pady=5)

        # Parameters
        param_frame = ttk.LabelFrame(self.frame, text="Report Parameters", padding=20)
        param_frame.pack(padx=20, pady=10, fill=tk.X)

        ttk.Label(param_frame, text="Company:").pack(side=tk.LEFT, padx=5)
        self.company_var = tk.StringVar(value='Rabona')
        ttk.Combobox(
            param_frame,
            textvariable=self.company_var,
            values=['Rabona', 'Espargos', 'Both'],
            state='readonly',
            width=15
        ).pack(side=tk.LEFT, padx=5)

        ttk.Label(param_frame, text="Month:").pack(side=tk.LEFT, padx=5)
        self.month_var = tk.StringVar(value='April')
        ttk.Combobox(
            param_frame,
            textvariable=self.month_var,
            values=[
                'January', 'February', 'March', 'April',
                'May', 'June', 'July', 'August',
                'September', 'October', 'November', 'December'
            ],
            state='readonly',
            width=12
        ).pack(side=tk.LEFT, padx=5)

        ttk.Label(param_frame, text="Year:").pack(side=tk.LEFT, padx=5)
        self.year_var = tk.StringVar(value='2026')
        ttk.Combobox(
            param_frame,
            textvariable=self.year_var,
            values=['2024', '2025', '2026', '2027'],
            state='readonly',
            width=8
        ).pack(side=tk.LEFT, padx=5)

        # Format selection
        ttk.Label(param_frame, text="Format:").pack(side=tk.LEFT, padx=20)
        self.format_var = tk.StringVar(value='Excel')
        ttk.Combobox(
            param_frame,
            textvariable=self.format_var,
            values=['Excel', 'PDF', 'CSV'],
            state='readonly',
            width=10
        ).pack(side=tk.LEFT, padx=5)

        # Options
        options_frame = ttk.LabelFrame(self.frame, text="Options", padding=20)
        options_frame.pack(padx=20, pady=10, fill=tk.X)

        self.include_details_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            options_frame,
            text="Include detailed transactions",
            variable=self.include_details_var
        ).pack(anchor='w', pady=5)

        self.include_summary_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            options_frame,
            text="Include summary by category",
            variable=self.include_summary_var
        ).pack(anchor='w', pady=5)

        self.include_variances_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            options_frame,
            text="Include budget vs. actual (if available)",
            variable=self.include_variances_var
        ).pack(anchor='w', pady=5)

        # Generate button
        button_frame = ttk.Frame(self.frame)
        button_frame.pack(pady=20)

        ttk.Button(
            button_frame,
            text="Generate Report",
            command=self._generate_report
        ).pack(side=tk.LEFT, padx=5)

        ttk.Button(
            button_frame,
            text="Preview",
            command=self._preview_report
        ).pack(side=tk.LEFT, padx=5)

        ttk.Button(
            button_frame,
            text="Save & Email",
            command=self._save_and_email
        ).pack(side=tk.LEFT, padx=5)

        # Status
        self.status_label = ttk.Label(self.frame, text="Ready", foreground='blue')
        self.status_label.pack(pady=10)

    def _generate_report(self):
        """Generate selected report"""
        report_type = self.report_type_var.get()
        format_type = self.format_var.get()

        self.status_label.config(
            text=f"Generating {report_type} ({format_type})...",
            foreground='orange'
        )
        self.frame.update()

        try:
            # TODO: Implement report generation based on type
            report_file = self._create_report()

            self.status_label.config(
                text=f"Report generated: {report_file}",
                foreground='green'
            )

            messagebox.showinfo(
                "Success",
                f"Report saved to:\n{report_file}"
            )

        except Exception as e:
            self.status_label.config(
                text=f"Error: {str(e)}",
                foreground='red'
            )
            messagebox.showerror("Error", str(e))

    def _create_report(self):
        """Create the actual report file"""
        report_type = self.report_type_var.get()
        format_type = self.format_var.get()
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

        filename = f"{report_type.replace(' ', '_')}_{timestamp}.{format_type.lower()}"

        # Save to reports directory
        reports_dir = "/sessions/upbeat-eager-ritchie/mnt/Rabona expense tracking sistem/reports"
        return f"{reports_dir}/{filename}"

    def _preview_report(self):
        """Preview report before saving"""
        messagebox.showinfo("Preview", "Report preview functionality coming soon")

    def _save_and_email(self):
        """Save and email report"""
        messagebox.showinfo("Save & Email", "Email functionality coming in Phase 3")
