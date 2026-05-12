import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { BankParser } from './components/BankParser/BankParser'
import { ViewExpenses } from './components/ViewExpenses/ViewExpenses'
import { AddExpense } from './components/AddExpense/AddExpense'
import { Dashboard } from './components/Dashboard/Dashboard'
import { ShareholderReport } from './components/ShareholderReport/ShareholderReport'
import { TravelLog } from './components/TravelLog/TravelLog'
import { ClientReport } from './components/ClientReport/ClientReport'
import './App.css'

function App() {
  const [companies, setCompanies] = useState([])
  const [selectedCompany, setSelectedCompany] = useState('Rabona Holdings')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [currentTab, setCurrentTab] = useState('bank-parser')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Load companies on mount
  useEffect(() => {
    const loadCompanies = async () => {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('companies')
          .select('name')
          .order('name')

        if (error) throw error

        const companyNames = data.map(c => c.name)
        setCompanies(companyNames)
        if (companyNames.length > 0) {
          setSelectedCompany(companyNames[0])
        }
      } catch (err) {
        console.error('Error loading companies:', err)
        setError('Failed to load companies. Check Supabase connection.')
      } finally {
        setLoading(false)
      }
    }

    loadCompanies()
  }, [])

  if (loading) {
    return <div className="loading">Loading Rabona Expense Tracker...</div>
  }

  if (error) {
    return <div className="error">{error}</div>
  }

  return (
    <div className="app">
      <header>
        <h1>Rabona Holdings & Espargos - Expense Tracker</h1>
        <p>Phase 1: Foundation Build</p>
      </header>

      <div className="container">
        {/* Top Bar */}
        <div className="top-bar">
          <div className="company-selector">
            <label>Company:</label>
            <select value={selectedCompany} onChange={(e) => setSelectedCompany(e.target.value)}>
              {companies.map(c => (
                <option key={c} value={c}>{c}</option>
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
            className={`tab-button ${currentTab === 'shareholder' ? 'active' : ''}`}
            onClick={() => setCurrentTab('shareholder')}
          >
            Shareholder Report
          </button>
          <button
            className={`tab-button ${currentTab === 'travel' ? 'active' : ''}`}
            onClick={() => setCurrentTab('travel')}
          >
            Travel Log
          </button>
          <button
            className={`tab-button ${currentTab === 'client' ? 'active' : ''}`}
            onClick={() => setCurrentTab('client')}
          >
            Client Report
          </button>
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
        {currentTab === 'bank-parser' && <BankParser selectedCompany={selectedCompany} />}
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
  )
}

export default App
