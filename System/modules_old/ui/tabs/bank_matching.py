"""Bank Statement Matching tab"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import threading


class BankMatchingTab:
    """Tab for matching bank statements to expenses"""

    def __init__(self, parent, excel_handler, bank_matcher, task_queue, result_queue):
        self.excel_handler = excel_handler
        self.bank_matcher = bank_matcher
        self.task_queue = task_queue
        self.result_queue = result_queue
        self.bank_file = None
        self.matches = []

        self.frame = ttk.Frame(parent)
        self._create_ui()

    def _create_ui(self):
        """Create bank matching UI"""
        # Title
        title_label = ttk.Label(
            self.frame,
            text="Bank Statement Matching",
            font=('Arial', 14, 'bold')
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

        # Upload bank statement
        upload_frame = ttk.LabelFrame(self.frame, text="1. Upload Bank Statement", padding=15)
        upload_frame.pack(padx=20, pady=10, fill=tk.X)

        ttk.Button(
            upload_frame,
            text="Select CSV or Excel Bank Statement",
            command=self._select_bank_file
        ).pack(pady=10)

        self.bank_file_label = ttk.Label(upload_frame, text="No file selected", foreground='gray')
        self.bank_file_label.pack()

        # Matching settings
        settings_frame = ttk.LabelFrame(self.frame, text="2. Matching Settings", padding=15)
        settings_frame.pack(padx=20, pady=10, fill=tk.X)

        ttk.Label(settings_frame, text="Date Tolerance (days):").pack(side=tk.LEFT, padx=5)
        self.date_tolerance_var = tk.IntVar(value=3)
        ttk.Spinbox(
            settings_frame,
            from_=0, to=10,
            textvariable=self.date_tolerance_var,
            width=5
        ).pack(side=tk.LEFT, padx=5)

        ttk.Label(settings_frame, text="Amount Tolerance (€):").pack(side=tk.LEFT, padx=5)
        self.amount_tolerance_var = tk.DoubleVar(value=0.01)
        ttk.Entry(settings_frame, textvariable=self.amount_tolerance_var, width=10).pack(side=tk.LEFT, padx=5)

        # Run matching
        ttk.Button(
            settings_frame,
            text="Find Matches",
            command=self._find_matches
        ).pack(side=tk.LEFT, padx=20)

        # Results
        results_frame = ttk.LabelFrame(self.frame, text="3. Match Candidates", padding=15)
        results_frame.pack(padx=20, pady=10, fill=tk.BOTH, expand=True)

        columns = ('Bank Date', 'Amount', 'Description', 'Expense Ref', 'Exp Date', 'Exp Amount', 'Confidence')
        self.matches_tree = ttk.Treeview(results_frame, columns=columns, height=10)
        self.matches_tree.heading('#0', text='#')
        self.matches_tree.heading('Bank Date', text='Bank Date')
        self.matches_tree.heading('Amount', text='Amount')
        self.matches_tree.heading('Description', text='Description')
        self.matches_tree.heading('Expense Ref', text='Exp Ref')
        self.matches_tree.heading('Exp Date', text='Exp Date')
        self.matches_tree.heading('Exp Amount', text='Exp Amount')
        self.matches_tree.heading('Confidence', text='Confidence')

        self.matches_tree.column('#0', width=30)
        self.matches_tree.column('Bank Date', width=80)
        self.matches_tree.column('Amount', width=80)
        self.matches_tree.column('Description', width=150)
        self.matches_tree.column('Expense Ref', width=80)
        self.matches_tree.column('Exp Date', width=80)
        self.matches_tree.column('Exp Amount', width=80)
        self.matches_tree.column('Confidence', width=80)

        self.matches_tree.pack(fill=tk.BOTH, expand=True)

        scrollbar = ttk.Scrollbar(results_frame, orient=tk.VERTICAL, command=self.matches_tree.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.matches_tree.config(yscrollcommand=scrollbar.set)

        # Status
        self.status_label = ttk.Label(self.frame, text="Ready", foreground='blue')
        self.status_label.pack(pady=10)

        # Action buttons
        action_frame = ttk.Frame(self.frame)
        action_frame.pack(pady=15)

        ttk.Button(
            action_frame,
            text="Approve Selected Match",
            command=self._approve_match
        ).pack(side=tk.LEFT, padx=5)

        ttk.Button(
            action_frame,
            text="Reject & Review Manually",
            command=self._reject_match
        ).pack(side=tk.LEFT, padx=5)

    def _select_bank_file(self):
        """Select bank statement file"""
        file = filedialog.askopenfilename(
            title="Select Bank Statement",
            filetypes=[
                ("CSV/Excel", "*.csv *.xlsx"),
                ("CSV", "*.csv"),
                ("Excel", "*.xlsx"),
            ]
        )

        if file:
            self.bank_file = file
            self.bank_file_label.config(
                text=f"Loaded: {file.split('/')[-1]}",
                foreground='green'
            )

    def _find_matches(self):
        """Find matches between bank and expenses"""
        if not self.bank_file:
            messagebox.showwarning("No File", "Please select a bank statement first")
            return

        self.status_label.config(text="Processing... please wait", foreground='orange')
        self.frame.update()

        # Run matching in background
        thread = threading.Thread(target=self._matching_worker)
        thread.daemon = True
        thread.start()

    def _matching_worker(self):
        """Background worker for bank matching"""
        try:
            company = self.company_var.get()
            date_tol = self.date_tolerance_var.get()
            amount_tol = self.amount_tolerance_var.get()

            # Find matches
            matches = self.bank_matcher.find_matches(
                company,
                self.bank_matcher.parse_bank_statement(self.bank_file),
                date_tolerance=date_tol,
                amount_tolerance=amount_tol
            )

            self.matches = matches

            # Populate tree
            self.matches_tree.delete(*self.matches_tree.get_children())
            for idx, match in enumerate(matches):
                bank = match['bank_trans']
                expense = match['expense']

                self.matches_tree.insert('', tk.END, text=str(idx + 1), values=(
                    bank['date'],
                    f"{bank['amount']:.2f}",
                    bank['description'][:40],
                    expense['reference'],
                    expense['date'],
                    f"{expense['amount']:.2f}",
                    f"{match['confidence']:.0f}%"
                ))

            self.status_label.config(
                text=f"Found {len(matches)} potential matches",
                foreground='green'
            )

        except Exception as e:
            self.status_label.config(
                text=f"Error: {str(e)}",
                foreground='red'
            )

    def _approve_match(self):
        """Approve selected match"""
        selection = self.matches_tree.selection()
        if not selection:
            messagebox.showwarning("No Selection", "Please select a match to approve")
            return

        item_id = selection[0]
        idx = int(self.matches_tree.item(item_id, 'text')) - 1

        if idx < len(self.matches):
            match = self.matches[idx]
            expense_ref = match['expense']['reference']
            company = self.company_var.get()

            result = self.bank_matcher.approve_match(company, expense_ref, match['bank_trans'])

            if result['status'] == 'success':
                messagebox.showinfo("Success", f"Match approved for {expense_ref}")
                self.matches_tree.delete(item_id)
            else:
                messagebox.showerror("Error", result.get('message', 'Failed to approve'))

    def _reject_match(self):
        """Reject selected match"""
        selection = self.matches_tree.selection()
        if not selection:
            messagebox.showwarning("No Selection", "Please select a match")
            return

        self.matches_tree.delete(selection[0])
        messagebox.showinfo("Rejected", "You can manually match this transaction")
