/*
  global
  reportData, moment, React, ReactDOM
*/
'use strict'

function round (number, precision) {
  const factor = Math.pow(10, precision)
  const tempNumber = number * factor
  const roundedTempNumber = Math.round(tempNumber)
  return roundedTempNumber / factor
}

class App extends React.Component {
  renderTable (title, report) {
    return (
      <div>
        <h1>{title}</h1>
        <table className='table table-hover table-inverse tw-report-table'>
          <thead>
            <tr>
              <th>Date</th>
              <th>
                Marketing Cost
                <div className='details'>Other</div>
              </th>
              <th>
                Marketing Cost
                <div className='details'>Paid Traffic</div>
              </th>
              <th>
                Clicks
                <div className='details'>Paid Traffic</div>
              </th>
              <th>
                Signups
                <div className='details'>Total</div>
              </th>
              <th>
                Signups
                <div className='details'>Paid Traffic</div>
              </th>
              <th>
                Licenses
                <div className='details'>Total</div>
              </th>
              <th>
                Licenses
                <div className='details'>Paid Traffic</div>
              </th>

              <th>
                Cost per License
                <div className='details'>Total</div>
              </th>
              <th>
                Cost per License
                <div className='details'>Paid Traffic</div>
              </th>
              <th>
                Cost per Signup
                <div className='details'>Paid Traffic</div>
              </th>

              <th>
                Conversion Rate
                <div className='details'>Total</div>
              </th>
              <th>
                Conversion Rate
                <div className='details'>Paid Traffic</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {report.map((x, i) => (
              <ReportRow key={i} row={x} />
            ))}
            <TotalRow key='total' report={report} />
          </tbody>
        </table>
      </div>
    )
  }
  render () {
    const { report } = this.props

    const months = Object.keys(report.month)
    months.sort((a, b) => b > a ? 1 : -1)
    const monthRows = months.map(x => {
      const r = report.month[x]
      r.date = moment(x, 'YYYYMM')
      return r
    })

    return (
      <div className='tw-report'>
        <div className='inner'>
          <hr/>
          {this.renderTable('Monthly Marketing Activity', monthRows)}
        </div>
      </div>
    )
  }
}

App.propTypes = {
  report: React.PropTypes.array.isRequired
}

const ReportRow = ({ row }) => {
  const style = { textAlign: 'right' }
  const percentagePaidVsUnpaid = row.totalLicenses
    ? Math.round(row.licensesPaidMarketing / row.totalLicenses * 100)
    : null
  return (
    <tr>
      <td style={style}>{row.date.format('YYYY-MM')}</td>
      <td style={style}>$ {round(row.totalCostOtherMarketing, 2).toLocaleString()}</td>
      <td style={style}>$ {round(row.totalCostPaidMarketing, 2).toLocaleString()}</td>
      <td style={style}>{row.totalClicks.toLocaleString()}</td>
      <td style={style}>{row.totalSignups.toLocaleString()}</td>
      <td style={style}>{row.signupsPaidMarketing.toLocaleString()}</td>
      <td style={style}>{row.totalLicenses.toLocaleString()}</td>
      <td style={{ ...style, position: 'relative' }}>
        {row.licensesPaidMarketing.toLocaleString()}
        <div className='details fixed-right'>
          {percentagePaidVsUnpaid ? '(' + percentagePaidVsUnpaid + ' %)' : ''}
        </div>
      </td>

      <td style={style}>$ {round(row.costPerLicenseAllChannels, 2).toLocaleString()}</td>
      <td style={style}>$ {round(row.costPerLicensePaidMarketing, 2).toLocaleString()}</td>
      <td style={style}>$ {round(row.costPerSignupPaidMarketing, 2).toLocaleString()}</td>

      <td style={style}>{row.conversionRateAllChannels} %</td>
      <td style={style}>{row.conversionRatePaidMarketing} %</td>
    </tr>
  )
}

const TotalRow = ({ report }) => {
  const style = { textAlign: 'right' }

  const getTotal = (field) => report.reduce((acc, x) => acc + x[field], 0)
  const getAverage = (field) => {
    return (
      report.reduce((acc, x) => acc + Number(x[field]), 0) /
      (report.filter(x => Number(x[field])).length || 1)
    )
  }

  return (
    <tr style={{ backgroundColor: '#4cb992', color: 'white' }}>
      <td style={style}>Total</td>
      <td style={style}>$ {round(getTotal('totalCostOtherMarketing'), 2).toLocaleString()}</td>
      <td style={style}>$ {round(getTotal('totalCostPaidMarketing'), 2).toLocaleString()}</td>
      <td style={style}>{getTotal('totalClicks').toLocaleString()}</td>
      <td style={style}>{getTotal('totalSignups').toLocaleString()}</td>
      <td style={style}>{getTotal('signupsPaidMarketing').toLocaleString()}</td>
      <td style={style}>{getTotal('totalLicenses').toLocaleString()}</td>
      <td style={style}>{getTotal('licensesPaidMarketing').toLocaleString()}</td>

      <td style={style}>$ {round(getAverage('costPerLicenseAllChannels'), 2).toLocaleString()}</td>
      <td style={style}>$ {round(getAverage('costPerLicensePaidMarketing'), 2).toLocaleString()}</td>
      <td style={style}>$ {round(getAverage('costPerSignupPaidMarketing'), 2).toLocaleString()}</td>

      <td style={style}>{round(getAverage('conversionRateAllChannels'), 2)} %</td>
      <td style={style}>{round(getAverage('conversionRatePaidMarketing'), 2)} %</td>
    </tr>
  )
}

ReactDOM.render(
  <App report={reportData} />,
  document.getElementById('react-app')
)
