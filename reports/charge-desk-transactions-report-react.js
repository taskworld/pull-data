/*
  global
  reportData, moment, React, ReactDOM, classNames
*/
'use strict'

class App extends React.Component {
  renderStatsTable (title, report, opts = { }) {
    const style = opts.style || { }
    return (
      <div style={style}>
        <h1>{title}</h1>
        <table className='table table-hover table-inverse tw-report-table' style={{ minWidth: 400 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Total</th>
              <th>Refunded</th>
              <th>Canceled</th>
            </tr>
          </thead>
          <tbody>
            {report.map((x, i) => (
              <StatsReportRow
                key={i}
                row={x}
                remaining={report.length - i}
                opts={opts}
              />
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  renderTransactionsTable (title, report, opts = { }) {
    return (
      <div>
        <h1>{title}</h1>
        <table className='table table-hover table-inverse tw-report-table'>
          <thead>
            <tr>
              <th>Date</th>
              <th>Ago</th>
              <th>Product</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Customer Name</th>
              <th>Customer Email</th>
              <th>Refunded</th>
            </tr>
          </thead>
          <tbody>
            {report.map((x, i) => (
              <TransactionsReportRow
                key={i}
                row={x}
                remaining={report.length - i}
                opts={opts}
              />
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  render () {
    const { data } = this.props

    return (
      <div className='tw-report'>
        <div className='inner'>
          <div style={{ display: 'flex' }}>
            {this.renderStatsTable('Month', data.month, { style: { marginRight: 100 } })}
            {this.renderStatsTable('Day', data.day.slice(0, 30))}
          </div>
          <div>
            {this.renderTransactionsTable('Transactions', data.transactions.slice(0, 120))}
          </div>
        </div>
      </div>
    )
  }
}

App.propTypes = {
  data: React.PropTypes.object.isRequired
}

const ar = { textAlign: 'right' }
const today = moment().utc().startOf('day')
const thisMonth = moment().utc().startOf('month')

const StatsReportRow = ({ row, remaining, opts }) => {
  const isThisMonth = moment(row.date).utc().isSameOrAfter(thisMonth)
  const newCls = classNames({
    'nowrap': true,
    'row-light-green': isThisMonth
  })

  return (
    <tr className={newCls}>
      <td>{row.date}</td>
      <td style={ar}>$ {row.total}</td>
      <td style={ar}>$ {row.refunded}</td>
      <td style={ar}>$ {row.canceled}</td>
    </tr>
  )
}

const TransactionsReportRow = ({ row, remaining, opts }) => {
  const isToday = moment(row.occurred).utc().isAfter(today)
  const newCls = classNames({
    'nowrap': true,
    'row-light-green': isToday
  })

  return (
    <tr className={newCls}>
      <td>{moment(row.occurred).format('YYYY-MM-DD HH:mm')}</td>
      <td style={ar}>{row.occurred_relative}</td>
      <td style={ar}>{row.product_id}</td>
      <td style={ar}>$ {parseInt(row.amount, 10).toLocaleString()}</td>
      <td style={ar}>{row.status}</td>
      <td>{row.customer_name}</td>
      <td>{row.customer_email}</td>
      <td style={ar}>$ {parseInt(row.amount_refunded, 10).toLocaleString()}</td>
    </tr>
  )
}

ReactDOM.render(
  <App data={reportData} />,
  document.getElementById('react-app')
)
