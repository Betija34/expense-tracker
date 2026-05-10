# Bank Statement Parser - Technical Architecture

## Component Hierarchy

```
BankParser (Main Orchestrator)
│
├─ FileUpload Component
│  ├─ Drag & drop zone
│  ├─ File validation
│  ├─ OCR processing (Tesseract.js)
│  ├─ Transaction extraction (Regex)
│  └─ Database storage
│
├─ BankParserStats Component
│  ├─ Stat Card: Total Transactions
│  ├─ Stat Card: Edited Count
│  ├─ Stat Card: Finalized Count
│  └─ Stat Card: Finalization Status %
│
├─ TransactionTable Component
│  ├─ Filter Controls (All/Pending/Finalized)
│  ├─ Transaction Table
│  │  ├─ Selection checkbox column
│  │  ├─ Date column
│  │  ├─ Description column
│  │  ├─ Amount column (color-coded)
│  │  ├─ Type column (In/Out)
│  │  └─ Status column (Pending/Finalized)
│  └─ Bulk Action: Finalize Selected
│
└─ UploadedFiles Component
   ├─ Files Table
   │  ├─ Icon column
   │  ├─ File Name column
   │  ├─ Upload Date column
   │  ├─ Transaction Count column
   │  ├─ Status badge
   │  └─ Delete action button
   └─ File Management (delete with confirmation)
```

## Data Flow

### Import Flow
```
User Action: Drop/Select File
    ↓
FileUpload: Validate File Type
    ↓
FileUpload: Read File Content
    ├─ If Image/PDF: Tesseract OCR → Extract Text
    └─ If CSV: Parse CSV Lines
    ↓
FileUpload: Regex Pattern Matching
    ├─ Extract Dates (DD/MM/YYYY, DD-MM-YYYY)
    ├─ Extract Vendors
    ├─ Extract Amounts (with currency)
    └─ Determine Debit/Credit Type
    ↓
FileUpload: Account Type Detection
    ├─ Scan OCR text for "mastercard" or "credit"
    └─ Default to "Current Account"
    ↓
FileUpload: Generate Filename
    └─ Format: [Company]-[MM-YYYY]-[TransactionCount]
    ↓
Database: Insert bank_imports record
    └─ company_id, account_id, import_date, file_name, 
       file_type, transaction_count, status='completed'
    ↓
Database: Insert bank_transactions records (batch)
    └─ bank_import_id, company_id, account_id,
       transaction_date, description, amount,
       transaction_type, status='unmatched'
    ↓
BankParser: Handle Upload Success
    ├─ Set current bankImportId
    ├─ Trigger loadStats()
    └─ Show success message
    ↓
BankParserStats: Update KPIs
    └─ Fetch transactions for bankImportId
       ├─ totalTransactions = count(*)
       ├─ editedCount = count(status='unmatched')
       └─ finalizedCount = count(status='matched')
    ↓
TransactionTable: Load & Display
    ├─ Query all transactions for bankImportId
    ├─ Sort by transaction_date (descending)
    └─ Display in table with filters
    ↓
UploadedFiles: Update List
    └─ Reload imports for selectedCompany
```

### Finalization Flow
```
User Action: Select Pending Transactions + Click Finalize
    ↓
TransactionTable: handleImportSelected()
    ├─ Collect selected transaction IDs
    └─ For each transaction:
        ├─ Update status: 'unmatched' → 'matched'
        └─ Save to database
    ↓
TransactionTable: Post-Update Actions
    ├─ Reload transactions from database
    ├─ Clear selections
    ├─ Call onStatusChange callback
    └─ Show success alert
    ↓
BankParser: onStatusChange triggers loadStats()
    └─ Refetch transaction counts
    ↓
BankParserStats: Auto-Update
    └─ Display new finalization percentage
    ↓
TransactionTable: Auto-Refresh
    └─ Show updated status badges and colors
```

### Delete Flow
```
User Action: Click Delete Button on File
    ↓
UploadedFiles: handleDelete(importId)
    ├─ Show confirmation dialog
    └─ Wait for user confirmation
    ↓
If Confirmed:
    ├─ Delete from bank_transactions table
    │  └─ WHERE bank_import_id = importId
    ├─ Delete from bank_imports table
    │  └─ WHERE id = importId
    └─ Update UI (remove from list)
    ↓
UploadedFiles: Call onRefresh callback
    └─ Trigger parent to refresh stats
    ↓
BankParser: handleImportRefresh()
    └─ Trigger stats reload
    ↓
BankParserStats: Recalculate
    └─ Show updated counts
```

## State Management

### BankParser (Parent State)
```javascript
{
  currentBankImportId: UUID | null,
  stats: {
    totalTransactions: number,
    editedCount: number,
    finalizedCount: number
  },
  refreshTrigger: number  // Incremented to trigger useEffect
}
```

### FileUpload (Local State)
```javascript
{
  files: File[],
  uploading: boolean,
  error: string | null,
  success: string | null,
  processingStatus: string
}
```

### BankParserStats (Local State)
```javascript
{
  stats: {
    totalTransactions: number,
    editedCount: number,
    finalizedCount: number
  }
}
```

### TransactionTable (Local State)
```javascript
{
  transactions: Transaction[],
  loading: boolean,
  selectedTransactions: Set<UUID>,
  filterStatus: 'all' | 'matched' | 'unmatched'
}
```

### UploadedFiles (Local State)
```javascript
{
  imports: Import[],
  loading: boolean
}
```

## Database Schema (Relevant Tables)

### bank_imports
```sql
CREATE TABLE bank_imports (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  account_id UUID REFERENCES accounts(id),
  import_date DATE,
  file_name VARCHAR(255),
  file_type VARCHAR(50),  -- 'csv', 'pdf', 'image'
  transaction_count INT,
  processed_count INT,
  status VARCHAR(50),  -- 'pending', 'processing', 'completed', 'error'
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### bank_transactions
```sql
CREATE TABLE bank_transactions (
  id UUID PRIMARY KEY,
  bank_import_id UUID REFERENCES bank_imports(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id),
  account_id UUID REFERENCES accounts(id),
  transaction_date DATE,
  amount DECIMAL(12, 2),
  description TEXT,
  transaction_type VARCHAR(50),  -- 'debit', 'credit'
  matched_expense_id UUID REFERENCES expenses(id),
  status VARCHAR(50),  -- 'unmatched', 'matched', 'pending_review'
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

## CSS Class Architecture

### Layout Classes
- `.bank-parser-section` - Main container
- `.parser-container` - Content wrapper with shadow/padding
- `.section-divider` - Visual separator between sections

### FileUpload Classes
- `.file-upload-section` - Section wrapper
- `.upload-area` - Drop zone with dashed border
- `.upload-area.drag-over` - Highlight during drag
- `.file-list` - Selected files preview
- `.file-list li` - Individual file item
- `.btn-remove` - Delete file button

### Stats Classes
- `.bank-parser-stats` - Grid container (4 columns)
- `.stat-card` - Individual stat container
- `.stat-card.total|edited|finalized|finalization-status` - Type variants
- `.stat-label` - Text label
- `.stat-value` - Numeric value
- `.stat-value.warning` - Warning color variant

### TransactionTable Classes
- `.transaction-section` - Section wrapper
- `.transaction-header` - Title + stats line
- `.transaction-stats` - Stats display line
- `.filter-group` - Filter button container
- `.filter-btn` - Individual filter button
- `.filter-btn.active` - Active filter state
- `.table-container` - Scrollable table wrapper
- `.bank-transactions-table` - Table element
- `.status-unmatched` - Row background for pending
- `.status-matched` - Row background for finalized
- `.amount-incoming` - Green amount text
- `.amount-outgoing` - Red amount text

### UploadedFiles Classes
- `.uploaded-files-section` - Section wrapper
- `.files-table` - Table wrapper
- `.files-table table|thead|th|td` - Table elements
- `.status-badge` - Status indicator
- `.status-badge.completed|pending` - Status variants
- `.btn-delete` - Delete button
- `.file-name|icon|date|transactions|action` - Column styling

### Message Classes
- `.message` - Message container base
- `.message.error` - Error styling (red)
- `.message.success` - Success styling (green)
- `.message.info` - Info styling (blue)

### Button Classes
- `.button` - Primary action button
- `.button:hover` - Hover state
- `.button:disabled` - Disabled state

## Responsive Design Breakpoints

### Desktop (768px+)
- `.bank-parser-stats` - 4 columns grid
- `.stat-card` - Full size with shadows
- Horizontal layout for transaction header

### Tablet (480px - 768px)
- `.bank-parser-stats` - 2 columns grid
- `.stat-value` - 24px font
- Transaction header becomes vertical layout

### Mobile (< 480px)
- `.bank-parser-stats` - 1 column
- `.button` - Full width (100%)
- Reduced padding and font sizes
- Simplified flex layouts

## Performance Optimizations

### Lazy Loading
- Transactions loaded only when bankImportId is set
- Stats recalculated only on import or status change
- Filters applied client-side (no additional queries)

### Efficient Querying
- Single query per import (all transactions at once)
- Indexed columns: bank_import_id, status, transaction_date
- Batch inserts for multiple transactions

### Rendering Optimization
- Memoized components (potential for React.memo)
- CSS transitions instead of JS animations
- Set data structure for O(1) checkbox lookups

## Error Handling Strategy

### FileUpload Errors
```
Invalid File Type
  ↓ Show error message
  ↓ Clear file selection
  ↓ Allow user to retry

OCR Processing Error
  ↓ Log error to console
  ↓ Show user-friendly message
  ↓ Suggest retry or different file

Database Insert Error
  ↓ Rollback transaction
  ↓ Alert user with error message
  ↓ Log server error details
```

### TransactionTable Errors
```
Load Transaction Error
  ↓ Log to console
  ↓ Show empty state
  ↓ Allow user to refresh

Status Update Error
  ↓ Alert user
  ↓ Reload from server
  ↓ Maintain UI consistency
```

### UploadedFiles Errors
```
Delete Error
  ↓ Alert user with error message
  ↓ Reload file list
  ↓ Keep files in display

Load Files Error
  ↓ Show empty state
  ↓ Log error
  ↓ Allow retry
```

## Future Enhancement Points

### Suggested Architecture for Next Features
1. **TransactionMatcher** - Component for expense matching
2. **BankReconciliation** - Reconciliation report generation
3. **TransactionSearch** - Advanced search/filter panel
4. **ImportTemplate** - Template detection & selection
5. **BulkEditor** - Bulk transaction editing UI

### Scalability Considerations
- Consider pagination for 1000+ transactions
- Implement virtual scrolling for large tables
- Add search/filtering to reduce render load
- Consider background processing for OCR (Web Workers)
