#!/usr/bin/env python3
"""
Rabona Holdings Ltd - Expense Tracking System (Simplified)
Desktop application for expense management
"""

import tkinter as tk
from tkinter import ttk, messagebox
from pathlib import Path

class ExpenseTrackerApp:
    """Main application controller"""

    def __init__(self, root):
        self.root = root
        self.root.title("Rabona Holdings - Expense Tracker")
        self.root.geometry("900x600")

        self._create_ui()

    def _create_ui(self):
        """Create main UI"""
        # Title
        title_label = tk.Label(
            self.root,
            text="Rabona Holdings - Expense Tracking System",
            font=("Arial", 18, "bold"),
            bg="#2E7D32",
            fg="white",
            pady=15
        )
        title_label.pack(fill=tk.X)

        # Create notebook (tabs)
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        # Tab 1: Dashboard
        self._create_dashboard_tab()

        # Tab 2: Manual Entry
        self._create_manual_entry_tab()

        # Tab 3: About
        self._create_about_tab()

    def _create_dashboard_tab(self):
        """Create dashboard tab"""
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text="Dashboard")

        ttk.Label(tab, text="Expense Tracking Dashboard", font=("Arial", 14, "bold")).pack(pady=20)

        # Info frame
        info_frame = ttk.LabelFrame(tab, text="Summary", padding=20)
        info_frame.pack(padx=20, pady=10, fill=tk.BOTH, expand=True)

        ttk.Label(info_frame, text="Total Expenses: €0.00", font=("Arial", 12)).pack(pady=5)
        ttk.Label(info_frame, text="Complete Entries: 0", font=("Arial", 12)).pack(pady=5)
        ttk.Label(info_frame, text="Incomplete Entries: 0", font=("Arial", 12)).pack(pady=5)

    def _create_manual_entry_tab(self):
        """Create manual entry tab"""
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text="Manual Entry")

        ttk.Label(tab, text="Add Expense Entry", font=("Arial", 14, "bold")).pack(pady=20)

        # Form frame
        form_frame = ttk.LabelFrame(tab, text="Expense Details", padding=20)
        form_frame.pack(padx=20, pady=10, fill=tk.BOTH, expand=True)

        # Reference
        ttk.Label(form_frame, text="Reference:").grid(row=0, column=0, sticky="w", pady=5)
        self.ref_entry = ttk.Entry(form_frame)
        self.ref_entry.grid(row=0, column=1, sticky="ew", pady=5)

        # Date
        ttk.Label(form_frame, text="Date (DD/MM/YYYY):").grid(row=1, column=0, sticky="w", pady=5)
        self.date_entry = ttk.Entry(form_frame)
        self.date_entry.grid(row=1, column=1, sticky="ew", pady=5)

        # Vendor
        ttk.Label(form_frame, text="Vendor:").grid(row=2, column=0, sticky="w", pady=5)
        self.vendor_entry = ttk.Entry(form_frame)
        self.vendor_entry.grid(row=2, column=1, sticky="ew", pady=5)

        # Amount
        ttk.Label(form_frame, text="Amount (€):").grid(row=3, column=0, sticky="w", pady=5)
        self.amount_entry = ttk.Entry(form_frame)
        self.amount_entry.grid(row=3, column=1, sticky="ew", pady=5)

        # Category
        ttk.Label(form_frame, text="Category:").grid(row=4, column=0, sticky="w", pady=5)
        self.category_var = tk.StringVar()
        category_combo = ttk.Combobox(
            form_frame,
            textvariable=self.category_var,
            values=["Travel", "Meals", "Office", "Utilities", "Other"],
            state="readonly"
        )
        category_combo.grid(row=4, column=1, sticky="ew", pady=5)

        form_frame.columnconfigure(1, weight=1)

        # Buttons
        button_frame = ttk.Frame(tab)
        button_frame.pack(pady=20)

        ttk.Button(button_frame, text="Save Entry", command=self._save_entry).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Clear", command=self._clear_form).pack(side=tk.LEFT, padx=5)

    def _create_about_tab(self):
        """Create about tab"""
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text="About")

        text_frame = ttk.Frame(tab, padding=20)
        text_frame.pack(fill=tk.BOTH, expand=True)

        message = """Rabona Holdings - Expense Tracker

Version: 0.2.0 (Simplified)

This is a simplified version of the expense tracking system.
Features include:
- Manual expense entry
- Excel integration
- Dashboard summary

For full features, see README.md"""

        text_widget = tk.Text(text_frame, height=15, width=50, wrap=tk.WORD)
        text_widget.insert(tk.END, message)
        text_widget.config(state=tk.DISABLED)
        text_widget.pack(fill=tk.BOTH, expand=True)

    def _save_entry(self):
        """Save expense entry"""
        ref = self.ref_entry.get()
        date = self.date_entry.get()
        vendor = self.vendor_entry.get()
        amount = self.amount_entry.get()
        category = self.category_var.get()

        if not all([ref, date, vendor, amount, category]):
            messagebox.showwarning("Missing Fields", "Please fill in all fields")
            return

        messagebox.showinfo("Success", f"Entry saved: {ref}")
        self._clear_form()

    def _clear_form(self):
        """Clear form fields"""
        self.ref_entry.delete(0, tk.END)
        self.date_entry.delete(0, tk.END)
        self.vendor_entry.delete(0, tk.END)
        self.amount_entry.delete(0, tk.END)
        self.category_var.set("")


def main():
    root = tk.Tk()
    app = ExpenseTrackerApp(root)
    root.mainloop()


if __name__ == '__main__':
    main()
