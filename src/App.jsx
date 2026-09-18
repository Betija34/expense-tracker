import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { Login } from './components/Login/Login'
import { BankParser } from './components/BankParser/BankParser'
import { ViewExpenses } from './components/ViewExpenses/ViewExpenses'
import { AddExpense } from './components/AddExpense/AddExpense'
import { Dashboard } from './components/Dashboard/Dashboard'
import { ShareholderReport } from './components/ShareholderReport/ShareholderReport'
import { TravelLog } from './components/TravelLog/TravelLog'
import { ClientReport } from './components/ClientReport/ClientReport'
import { MonthlyChecklist } from './components/MonthlyChecklist/MonthlyChecklist'
import { Clients } from './components/Clients/Clients'
import { InvoiceBuilder } from './components/InvoiceBuilder/InvoiceBuilder'
import { LockProvider } from './lib/LockContext'
import { LockBanner } from './components/LockBanner/LockBanner'
import './App.css'

function App() {
  // ---- Auth gate ----------------------------------------------------------
  // The system is private: only a signed-in user may load any data. `session`
  // is null until a valid Supabase session exists. `authChecked` flips true
  // once we've asked Supabase whether a session is already stored (so we don't
  // flash the login screen for an already-logged-in user on refresh).
  const [session, setSession] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)

  // `companies` holds the full [{ id, name }] rows so child components
  // (like LockContext) can do per-company lookups by id. The top-bar
  // dropdown only needs the names, but ids are required for FKs.
  const [companies, setCompanies] = useState([])
  const [selectedCompany, setSelectedCompany] = useState('Rabona Holdings')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [currentTab, setCurrentTab] = useState('bank-parser')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // When a child tab wants to deep-link to a specific expense (e.g. Travel
  // Log's Pre-paid row clicking "View →"), it calls handleViewExpense(id):
  // we record the id and switch to View Expenses. View Expenses reads the
  // id and scrolls/highlights the row, then clears it.
  const [focusExpenseId, setFocusExpenseId] = useState(null)
  const handleViewExpense = (expenseId) => {
    setFocusExpenseId(expenseId)
    setCurrentTab('view-expenses')
  }

  // Track the Supabase auth session. Runs once on mount, then listens for
  // sign-in / sign-out events for the rest of the app's life.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthChecked(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    // onAuthStateChange sets session to null → the Login screen renders.
  }

  // Load companies once the user is signed in. Gated on `session` because,
  // with Row-Level Security on, an anonymous request returns nothing.
  useEffect(() => {
    if (!session) return
    const loadCompanies = async () => {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('companies')
          .select('id, name')
          .order('name')

        if (error) throw error

        setCompanies(data || [])
        if ((data || []).length > 0) {
          setSelectedCompany(data[0].name)
        }
      } catch (err) {
        console.error('Error loading companies:', err)
        setError('Failed to load companies. Check Supabase connection.')
      } finally {
        setLoading(false)
      }
    }

    loadCompanies()
  }, [session])

  // If the user is on a tab that's hidden for the newly selected company
  // (Client Report or Travel Log when on Espargos), bounce back to Dashboard.
  useEffect(() => {
    if (selectedCompany === 'Espargos' && (currentTab === 'client' || currentTab === 'travel')) {
      setCurrentTab('dashboard')
    }
  }, [selectedCompany, currentTab])

  // Still checking for an existing session — show nothing jarring.
  if (!authChecked) {
    return <div className="loading">Loading…</div>
  }

  // Not signed in → the only thing a visitor can see is the login screen.
  if (!session) {
    return <Login />
  }

  if (loading) {
    return <div className="loading">Loading Rabona Expense Tracker...</div>
  }

  if (error) {
    return <div className="error">{error}</div>
  }

  return (
    <LockProvider
      selectedCompany={selectedCompany}
      selectedMonth={selectedMonth}
      selectedYear={selectedYear}
      companies={companies}
    >
    <div className="app">
      <header>
        <h1>Rabona Holdings & Espargos - Expense Tracker</h1>
        <p>Phase 1: Foundation Build</p>
      </header>

      {/* Lock banner — visible only when the current (company, month, year)
          tuple is in closed_periods. Sits above the top-bar so it's
          impossible to miss. Hidden in print. */}
      <LockBanner
        selectedCompany={selectedCompany}
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
      />

      <div className="container">
        {/* Top Bar */}
        <div className="top-bar">
          <div className="company-selector">
            <label>Company:</label>
            <select value={selectedCompany} onChange={(e) => setSelectedCompany(e.target.value)}>
              {companies.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="date-selector">
            <label>Month:</label>
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(parseInt(e.target.value))}>
              {Array.from({length: 12}, (_, i) => (
                <option key={i+1} value={i+1}>{String(i+1).padStart(2, '0')}</option>
              ))}
            </select>

            <label>Year:</label>
            <select value={selectedYear} onChange={(e) => setSelectedYear(parseInt(e.target.value))}>
              {Array.from({length: 5}, (_, i) => (
                <option key={i} value={2023 + i}>{2023 + i}</option>
              ))}
            </select>
          </div>

          <button onClick={handleSignOut} className="signout-btn">Sign out</button>
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab-button ${currentTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setCurrentTab('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={`tab-button ${currentTab === 'checklist' ? 'active' : ''}`}
            onClick={() => setCurrentTab('checklist')}
          >
            Monthly Checklist
          </button>
          <button
            className={`tab-button ${currentTab === 'bank-parser' ? 'active' : ''}`}
            onClick={() => setCurrentTab('bank-parser')}
          >
            Bank Statement Parser
          </button>
          <button
            className={`tab-button ${currentTab === 'add-expense' ? 'active' : ''}`}
            onClick={() => setCurrentTab('add-expense')}
          >
            Add Expense
          </button>
          <button
            className={`tab-button ${currentTab === 'view-expenses' ? 'active' : ''}`}
            onClick={() => setCurrentTab('view-expenses')}
          >
            View Expenses
          </button>
          <button
            className={`tab-button ${currentTab === 'clients' ? 'active' : ''}`}
            onClick={() => setCurrentTab('clients')}
          >
            Client Invoicing
          </button>
          <button
            className={`tab-button ${currentTab === 'issue-invoice' ? 'active' : ''}`}
            onClick={() => setCurrentTab('issue-invoice')}
          >
            Issue Invoice
          </button>
          <button
            className={`tab-button ${currentTab === 'shareholder' ? 'active' : ''}`}
            onClick={() => setCurrentTab('shareholder')}
          >
            Shareholder Report
          </button>
          {selectedCompany !== 'Espargos' && (
            <button
              className={`tab-button ${currentTab === 'travel' ? 'active' : ''}`}
              onClick={() => setCurrentTab('travel')}
            >
              Travel Log
            </button>
          )}
          {selectedCompany !== 'Espargos' && (
            <button
              className={`tab-button ${currentTab === 'client' ? 'active' : ''}`}
              onClick={() => setCurrentTab('client')}
            >
              Client Report
            </button>
          )}
        </div>

        {/* Tab Content */}
        {currentTab === 'dashboard' && (
          <Dashboard
            selectedCompany={selectedCompany}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
            onSwitchTab={setCurrentTab}
          />
        )}
        {currentTab === 'checklist' && (
          <MonthlyChecklist
            selectedCompany={selectedCompany}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
            onSwitchTab={setCurrentTab}
          />
        )}
        {currentTab === 'bank-parser' && (
          <BankParser
            selectedCompany={selectedCompany}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
          />
        )}
        {currentTab === 'add-expense' && (
          <AddExpense
            selectedCompany={selectedCompany}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
            onSwitchTab={setCurrentTab}
          />
        )}
        {currentTab === 'view-expenses' && (
          <ViewExpenses
            selectedCompany={selectedCompany}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
            onSwitchTab={setCurrentTab}
            focusExpenseId={focusExpenseId}
            onFocusHandled={() => setFocusExpenseId(null)}
          />
        )}
        {currentTab === 'clients' && (
          <Clients
            selectedCompany={selectedCompany}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
          />
        )}
        {currentTab === 'issue-invoice' && (
          <InvoiceBuilder
            selectedCompany={selectedCompany}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
          />
        )}
        {currentTab === 'shareholder' && (
          <ShareholderReport
            selectedCompany={selectedCompany}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
            onSwitchTab={setCurrentTab}
          />
        )}
        {currentTab === 'travel' && (
          <TravelLog
            selectedCompany={selectedCompany}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
            onSwitchTab={setCurrentTab}
            onViewExpense={handleViewExpense}
          />
        )}
        {currentTab === 'client' && (
          <ClientReport
            selectedCompany={selectedCompany}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
            onSwitchTab={setCurrentTab}
          />
        )}
      </div>

      <footer>
        <p>Phase 1 Foundation • Connected to Supabase ✅</p>
      </footer>
    </div>
    </LockProvider>
  )
}

export default App
