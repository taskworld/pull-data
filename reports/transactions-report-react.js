/*
  global
  reportData, moment, React, ReactDOM, classNames
*/
'use strict'

class App extends React.Component {
  renderTable (title, report, opts = { }) {
    return (
      <div>
        <h1>{title}</h1>
        <table className='table table-hover table-inverse tw-report-table' style={{ width: 'auto' }}>
          <thead>
            <tr>
              <th>Month</th>
              <th>Workspaces</th>
              <th>New Licenses</th>
              <th>New Sales</th>
              <th>Recurring Sales</th>
              <th>Upsold</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {report.map((x, i) => (
              <ReportRow
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
          {this.renderTable('Transactions', data.past.concat(data.future))}
        </div>
      </div>
    )
  }
}

App.propTypes = {
  data: React.PropTypes.object.isRequired
}

const ar = { textAlign: 'right' }

const ReportRow = ({ row, remaining, opts }) => {
  const isThisMonth = row.month === moment().format('YYYY-MM')
  const isFuture = moment(row.month, 'YYYY-MM').isAfter(moment())

  const newCls = classNames({
    'nowrap': true,
    'row-green': isThisMonth && !isFuture,
    'row-amber': isFuture
  })

  return (
    <tr className={newCls}>
      <td>{row.month}</td>
      <td style={ar}>{row.workspaces}</td>
      <td style={ar}>{row.licenses}</td>
      <td style={ar}>$ {row.new.toLocaleString()}</td>
      <td style={ar}>$ {row.recurring.toLocaleString()}</td>
      <td style={ar}>$ {row.upsold.toLocaleString()}</td>
      <td style={ar}>$ {row.total.toLocaleString()}</td>
    </tr>
  )
}

ReactDOM.render(
  <App data={reportData} />,
  document.getElementById('react-app')
)
