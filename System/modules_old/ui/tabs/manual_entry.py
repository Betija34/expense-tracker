"""Manual Entry tab - add expenses manually"""

import tkinter as tk
from tkinter import ttk, messagebox
from datetime import datetime


class ManualEntryTab:
    """Tab for manually entering expenses"""

    def __init__(self, parent, excel_handler, task_queue, result_queue):
        self.excel_handler = excel_handler
        self.task_queue = task_queue
        self.result_queue = result_queue
        self.company_var = tk.StringVar(value='Rabona')

        self.frame = ttk.Frame(parent)
        self._create_ui()
        self._load_categories()

    def _create_ui(self):
        """Create manual entry form"""
        # Title
        title_label = ttk.Label(
            self.frame,
            text="Manual Expense Entry",
            font=('Arial', 14, 'bold')
        )
        title_label.pack(pady=10)

        # Company selector
        company_frame = ttk.Frame(self.frame)
        company_frame.pack(pady=10)

        ttk.Label(company_frame, text="Company:").pack(side=tk.LEFT, padx=5)
        company_combo = ttk.Combobox(
            company_frame,
            textvariable=self.company_var,
            values=['Rabona', 'Espargos'],
            state='readonly',
            width=15
        )
        company_combo.pack(side=tk.LEFT, padx=5)

        # Form frame
        form_frame = ttk.LabelFrame(self.frame, text="Expense Details", padding=20)
        form_frame.pack(padx=20, pady=10, fill=tk.BOTH, expand=True)

        # Reference (auto-generated)
        ttk.Label(form_frame, text="Reference (Auto):").grid(row=0, column=0, sticky='w', pady=5)
        self.ref_var = tk.StringVar()
        ttk.Entry(form_frame, textvariable=self.ref_var, state='readonly').grid(row=0, column=1, sticky='ew', pady=5)

        # Date
        ttk.Label(form_frame, text="Date (DD/MM/YYYY):").grid(row=1, column=0, sticky='w', pady=5)
        self.date_var = tk.StringVar(value=datetime.now().strftime('%d/%m/%Y'))
        ttk.Entry(form_frame, textvariable=self.date_var).grid(row=1, column=1, sticky='ew', pady=5)

        # Vendor
        ttk.Label(form_frame, text="Vendor/Merchant:").grid(row=2, column=0, sticky='w', pady=5)
        self.vendor_var = tk.StringVar()
        ttk.Entry(form_frame, textvariable=self.vendor_var).grid(row=2, column=1, sticky='ew', pady=5)

        # Description
        ttk.Label(form_frame, text="Description:").grid(row=3, column=0, sticky='nw', pady=5)
        self.desc_var = tk.StringVar()
        desc_entry = tk.Text(form_frame, height=3, width=40)
        desc_entry.grid(row=3, column=1, sticky='ew', pady=5)
        self.desc_var = desc_entry  # Store widget, not StringVar

        # Amount
        ttk.Label(form_frame, text="Amount (€):").grid(row=4, column=0, sticky='w', pady=5)
        self.amount_var = tk.StringVar()
        ttk.Entry(form_frame, textvariable=self.amount_var).grid(row=4, column=1, sticky='ew', pady=5)

        # Currency
        ttk.Label(form_frame, text="Currency:").grid(row=5, column=0, sticky='w', pady=5)
        self.currency_var = tk.StringVar(value='EUR')
        ttk.Combobox(
            form_frame, textvariable=self.currency_var,
            values=['EUR', 'USD', 'GBP'], state='readonly'
        ).grid(row=5, column=1, sticky='ew', pady=5)

        # Category
        ttk.Label(form_frame, text="Category:").grid(row=6, column=0, sticky='w', pady=5)
        self.category_var = tk.StringVar()
        self.category_combo = ttk.Combobox(form_frame, textvariable=self.category_var, state='readonly')
        self.category_combo.grid(row=6, column=1, sticky='ew', pady=5)

        # Subcategory
        ttk.Label(form_frame, text="Subcategory:").grid(row=7, column=0, sticky='w', pady=5)
        self.subcat_var = tk.StringVar()
        ttk.Entry(form_frame, textvariable=self.subcat_var).grid(row=7, column=1, sticky='ew', pady=5)

        # Payment Method
        ttk.Label(form_frame, text="Payment Method:").grid(row=8, column=0, sticky='w', pady=5)
        self.payment_var = tk.StringVar()
        payment_combo = ttk.Combobox(
            form_frame, textvariable=self.payment_var,
            values=['Cash', 'Card', 'Transfer', 'Cheque'],
            state='readonly'
        )
        payment_combo.grid(row=8, column=1, sticky='ew', pady=5)

        # Payment Breakdown (for Rabona only)
        breakdown_frame = ttk.LabelFrame(form_frame, text="Payment Breakdown", padding=10)
        breakdown_frame.grid(row=9, column=0, columnspan=2, sticky='ew', pady=10)

        ttk.Label(breakdown_frame, text="Company Portion (€):").grid(row=0, column=0, sticky='w')
        self.company_portion_var = tk.StringVar()
        ttk.Entry(breakdown_frame, textvariable=self.company_portion_var).grid(row=0, column=1, sticky='ew')

        ttk.Label(breakdown_frame, text="Client Portion (€):").grid(row=1, column=0, sticky='w')
        self.client_portion_var = tk.StringVar()
        ttk.Entry(breakdown_frame, textvariable=self.client_portion_var).grid(row=1, column=1, sticky='ew')

        ttk.Label(breakdown_frame, text="Shareholder Portion (€):").grid(row=2, column=0, sticky='w')
        self.shareholder_portion_var = tk.StringVar()
        ttk.Entry(breakdown_frame, textvariable=self.shareholder_portion_var).grid(row=2, column=1, sticky='ew')

        # Document link
        ttk.Label(form_frame, text="Document Link:").grid(row=10, column=0, sticky='w', pady=5)
        self.doc_link_var = tk.StringVar()
        ttk.Entry(form_frame, textvariable=self.doc_link_var).grid(row=10, column=1, sticky='ew', pady=5)

        form_frame.columnconfigure(1, weight=1)

        # Buttons
        button_frame = ttk.Frame(self.frame)
        button_frame.pack(pady=20)

        ttk.Button(
            button_frame,
            text="Generate Reference",
            command=self._generate_reference
        ).pack(side=tk.LEFT, padx=5)

        ttk.Button(
            button_frame,
            text="Save Entry",
            command=self._save_entry
        ).pack(side=tk.LEFT, padx=5)

        ttk.Button(
            button_frame,
            text="Clear Form",
            command=self._clear_form
        ).pack(side=tk.LEFT, padx=5)

    def _load_categories(self):
        """Load categories from Excel"""
        categories = self.excel_handler.get_categories(self.company_var.get())
        self.category_combo['values'] = categories

    def _generate_reference(self):
        """Generate next reference number"""
        company = self.company_var.get()
        ref = self.excel_handler.get_next_reference(company, month=4)
        self.ref_var.set(ref)

    def _save_entry(self):
        """Save expense entry to Excel"""
        if not self.ref_var.get():
            messagebox.showwarning("Missing Reference", "Please generate a reference first")
            return

        entry_data = {
            'reference': self.ref_var.get(),
            'date': self.date_var.get(),
            'vendor': self.vendor_var.get(),
            'description': self.desc_var.get("1.0", tk.END).strip(),
            'amount': float(self.amount_var.get() or 0),
            'currency': self.currency_var.get(),
            'category': self.category_var.get(),
            'subcategory': self.subcat_var.get(),
            'payment_method': self.payment_var.get(),
            'status': 'Incomplete',  # Default to incomplete
        }

        company = self.company_var.get()
        result = self.excel_handler.add_expense_entry(company, entry_data)

        if result['status'] == 'success':
            messagebox.showinfo("Success", f"Entry saved: {result['reference']}")
            self._clear_form()
        else:
            messagebox.showerror("Error", result.get('message', 'Failed to save'))

    def _clear_form(self):
        """Clear all form fields"""
        self.ref_var.set('')
        self.date_var.set(datetime.now().strftime('%d/%m/%Y'))
        self.vendor_var.set('')
        self.desc_var.delete("1.0", tk.END)
        self.amount_var.set('')
        self.currency_var.set('EUR')
        self.category_var.set('')
        self.subcat_var.set('')
        self.payment_var.set('')
        self.doc_link_var.set('')
        self.company_portion_var.set('')
        self.client_portion_var.set('')
        self.shareholder_portion_var.set('')
