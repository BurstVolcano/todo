import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <main className="fatal"><h1>Let’s try that again.</h1><p>Daylight couldn’t load this view.</p><button className="primary" onClick={() => location.reload()}>Reload Daylight</button></main>
    return this.props.children
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
