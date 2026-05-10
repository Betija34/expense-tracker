"""Document Upload tab - upload receipts/invoices and extract via OCR"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import threading
from pathlib import Path


class DocumentUploadTab:
    """Tab for uploading documents and OCR extraction"""

    def __init__(self, parent, excel_handler, ocr_processor, task_queue, result_queue):
        self.excel_handler = excel_handler
        self.ocr_processor = ocr_processor
        self.task_queue = task_queue
        self.result_queue = result_queue
        self.uploaded_files = []
        self.extracted_data = {}

        self.frame = ttk.Frame(parent)
        self._create_ui()

    def _create_ui(self):
        """Create upload tab UI"""
        # Title
        title_label = ttk.Label(
            self.frame,
            text="Upload Documents for OCR Processing",
            font=('Arial', 14, 'bold')
        )
        title_label.pack(pady=10)

        # File upload area
        upload_frame = ttk.LabelFrame(self.frame, text="1. Select Documents", padding=15)
        upload_frame.pack(padx=20, pady=10, fill=tk.X)

        ttk.Button(
            upload_frame,
            text="Browse & Select Files (PDF, PNG, JPG)",
            command=self._select_files
        ).pack(pady=10)

        # File list
        self.file_listbox = tk.Listbox(upload_frame, height=6)
        self.file_listbox.pack(fill=tk.BOTH, expand=True, pady=10)

        scrollbar = ttk.Scrollbar(upload_frame, orient=tk.VERTICAL, command=self.file_listbox.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.file_listbox.config(yscrollcommand=scrollbar.set)

        # Remove button
        ttk.Button(
            upload_frame,
            text="Remove Selected File",
            command=self._remove_file
        ).pack(pady=5)

        # OCR Processing
        ocr_frame = ttk.LabelFrame(self.frame, text="2. Extract Data via OCR", padding=15)
        ocr_frame.pack(padx=20, pady=10, fill=tk.X)

        ttk.Button(
            ocr_frame,
            text="Process Documents",
            command=self._process_documents
        ).pack(pady=10)

        # Progress
        self.progress_var = tk.DoubleVar()
        self.progress = ttk.Progressbar(
            ocr_frame,
            variable=self.progress_var,
            maximum=100,
            mode='determinate'
        )
        self.progress.pack(fill=tk.X, pady=5)

        self.progress_label = ttk.Label(ocr_frame, text="Ready")
        self.progress_label.pack()

        # Results
        results_frame = ttk.LabelFrame(self.frame, text="3. Review & Confirm Extracted Data", padding=15)
        results_frame.pack(padx=20, pady=10, fill=tk.BOTH, expand=True)

        # Create treeview for results
        columns = ('Field', 'Extracted Value', 'Confidence')
        self.results_tree = ttk.Treeview(results_frame, columns=columns, height=8)
        self.results_tree.heading('#0', text='File')
        self.results_tree.heading('Field', text='Field')
        self.results_tree.heading('Extracted Value', text='Value')
        self.results_tree.heading('Confidence', text='Confidence')

        self.results_tree.column('#0', width=200)
        self.results_tree.column('Field', width=100)
        self.results_tree.column('Extracted Value', width=200)
        self.results_tree.column('Confidence', width=80)

        self.results_tree.pack(fill=tk.BOTH, expand=True)

        # Scrollbar
        scrollbar = ttk.Scrollbar(results_frame, orient=tk.VERTICAL, command=self.results_tree.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.results_tree.config(yscrollcommand=scrollbar.set)

        # Action buttons
        action_frame = ttk.Frame(self.frame)
        action_frame.pack(pady=15)

        ttk.Button(
            action_frame,
            text="Edit & Save to Excel",
            command=self._save_to_excel
        ).pack(side=tk.LEFT, padx=5)

        ttk.Button(
            action_frame,
            text="Clear All",
            command=self._clear_all
        ).pack(side=tk.LEFT, padx=5)

    def _select_files(self):
        """Select files for upload"""
        files = filedialog.askopenfilenames(
            title="Select receipt/invoice documents",
            filetypes=[
                ("All Supported", "*.pdf *.png *.jpg *.jpeg"),
                ("PDF", "*.pdf"),
                ("Images", "*.png *.jpg *.jpeg"),
            ]
        )

        for file in files:
            if file not in self.uploaded_files:
                self.uploaded_files.append(file)
                self.file_listbox.insert(tk.END, Path(file).name)

    def _remove_file(self):
        """Remove selected file from list"""
        selection = self.file_listbox.curselection()
        if selection:
            idx = selection[0]
            self.file_listbox.delete(idx)
            del self.uploaded_files[idx]

    def _process_documents(self):
        """Process uploaded documents via OCR"""
        if not self.uploaded_files:
            messagebox.showwarning("No Files", "Please select files first")
            return

        self.progress_label.config(text="Processing...")
        self.results_tree.delete(*self.results_tree.get_children())

        # Run OCR in background thread
        thread = threading.Thread(target=self._ocr_worker)
        thread.daemon = True
        thread.start()

    def _ocr_worker(self):
        """Background worker for OCR processing"""
        try:
            total_files = len(self.uploaded_files)

            for idx, file_path in enumerate(self.uploaded_files):
                # Process file
                result = self.ocr_processor.process_document(file_path)

                if result['status'] == 'success':
                    data = result['data']
                    file_item = self.results_tree.insert('', tk.END, text=Path(file_path).name)

                    fields = [
                        ('Date', data.get('date', 'N/A')),
                        ('Vendor', data.get('vendor', 'N/A')),
                        ('Amount', f"{data.get('amount', 0):.2f}" if data.get('amount') else 'N/A'),
                        ('Currency', data.get('currency', 'EUR')),
                        ('Description', data.get('description', 'N/A')[:50]),
                    ]

                    for field, value in fields:
                        self.results_tree.insert(file_item, tk.END, values=(field, value, '85%'))

                    self.extracted_data[file_path] = data

                # Update progress
                progress = (idx + 1) / total_files * 100
                self.progress_var.set(progress)
                self.frame.after(0, lambda: None)  # Allow UI update

            self.progress_label.config(text="Done! Review extracted data above")

        except Exception as e:
            self.progress_label.config(text=f"Error: {str(e)}")

    def _save_to_excel(self):
        """Save extracted data to Excel"""
        if not self.extracted_data:
            messagebox.showwarning("No Data", "Extract data first")
            return

        # TODO: Implement save to Excel with user review form
        messagebox.showinfo("Save", "Saving extracted data to Excel...")

    def _clear_all(self):
        """Clear all uploaded files and results"""
        self.uploaded_files.clear()
        self.extracted_data.clear()
        self.file_listbox.delete(0, tk.END)
        self.results_tree.delete(*self.results_tree.get_children())
        self.progress_var.set(0)
        self.progress_label.config(text="Ready")
