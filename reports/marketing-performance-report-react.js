/*
  global
  reportData, moment, React, ReactDOM, classNames
*/
'use strict'

function round (number, precision) {
  const factor = Math.pow(10, precision)
  const tempNumber = number * factor
  const roundedTempNumber = Math.round(tempNumber)
  return roundedTempNumber / factor
}

/*
 * ============================================================================
 *
 * Monthly Report.
 *
 * ============================================================================
 */
class MonthlyReport extends React.Component {
  renderTable (title, report) {
    return (
      <div>
        <h1>{title}</h1>
        <table className='table table-hover table-inverse tw-report-table' style={{ whiteSpace: 'nowrap' }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>
                Marketing
                <div className='details'>Paid Traffic</div>
              </th>
              <th>
                Unique Visits
                <div className='details'>Total</div>
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
                Cost / License
                <div className='details'>Total</div>
              </th>
              <th>
                Cost / License
                <div className='details'>Paid Traffic</div>
              </th>
              <th>
                Cost / Signup
                <div className='details'>Paid Traffic</div>
              </th>

              <th>
                Churned
                <div className='details'>Licenses</div>
              </th>
              <th>
                MRR
                <div className='details'>Estimate</div>
              </th>

              <th>
                CR
                <div className='details'>Signup to Paid</div>
              </th>
              <th>
                CR
                <div className='details'>Visit to Paid</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {report.map((x, i) => (
              <MonthlyReportRow key={i} row={x} />
            ))}
            <MonthlyTotalRow key='total' report={report} />
          </tbody>
        </table>
      </div>
    )
  }
  render () {
    const { report } = this.props

    const thisMonth = moment().format('YYYYMM')
    const months = Object.keys(report.month)
    months.sort((a, b) => b > a ? 1 : -1)
    const monthRows = months
    .filter(x => x <= thisMonth)
    .map(x => {
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

MonthlyReport.propTypes = {
  report: React.PropTypes.array.isRequired
}

const MonthlyReportRow = ({ row }) => {
  const style = { textAlign: 'right' }
  const percentagePaidVsUnpaid = row.totalLicenses
    ? Math.round(row.licensesPaidMarketing / row.totalLicenses * 100)
    : null
  return (
    <tr>
      <td style={style}>{row.date.format('YYYY-MM')}</td>
      <td style={style}>$ {round(row.totalCostPaidMarketing, 2).toLocaleString()}</td>
      <td style={style}>{row.totalUsers.toLocaleString()}</td>
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

      <td style={style}>{row.totalLicensesChurned.toLocaleString()}</td>
      <td style={style}>$ {round(row.averageLicenseCost * row.totalLicenses, 0).toLocaleString()}</td>

      <td style={style}>{row.conversionRateAllChannels} %</td>
      <td style={style}>{row.conversionRateUsers} %</td>
    </tr>
  )
}

const MonthlyTotalRow = ({ report }) => {
  const style = { textAlign: 'right' }

  const getTotal = (field) => report.reduce((acc, x) => acc + x[field], 0)
  const getAverage = (field) => {
    return (
      report.reduce((acc, x) => acc + Number(x[field]), 0) /
      (report.filter(x => Number(x[field])).length || 1)
    )
  }
  const getTotalMRR = () => report.reduce((acc, x) => acc + (x.averageLicenseCost * x.totalLicenses), 0)

  return (
    <tr style={{ backgroundColor: '#4cb992', color: 'white' }}>
      <td style={style}>Total</td>
      <td style={style}>$ {round(getTotal('totalCostPaidMarketing'), 2).toLocaleString()}</td>
      <td style={style}>{getTotal('totalUsers').toLocaleString()}</td>
      <td style={style}>{getTotal('totalClicks').toLocaleString()}</td>
      <td style={style}>{getTotal('totalSignups').toLocaleString()}</td>
      <td style={style}>{getTotal('signupsPaidMarketing').toLocaleString()}</td>
      <td style={style}>{getTotal('totalLicenses').toLocaleString()}</td>
      <td style={style}>{getTotal('licensesPaidMarketing').toLocaleString()}</td>

      <td style={style}>$ {round(getAverage('costPerLicenseAllChannels'), 2).toLocaleString()}</td>
      <td style={style}>$ {round(getAverage('costPerLicensePaidMarketing'), 2).toLocaleString()}</td>
      <td style={style}>$ {round(getAverage('costPerSignupPaidMarketing'), 2).toLocaleString()}</td>

      <td style={style}>{getTotal('totalLicensesChurned').toLocaleString()}</td>
      <td style={style}>$ {round(getTotalMRR(), 0).toLocaleString()}</td>

      <td style={style}>{round(getAverage('conversionRateAllChannels'), 2)} %</td>
      <td style={style}>{round(getAverage('conversionRateUsers'), 2)} %</td>
    </tr>
  )
}

/*
 * ============================================================================
 *
 * AdGroups Report.
 *
 * ============================================================================
 */
class AdGroupReport extends React.Component {
  renderTable (title, report) {
    return (
      <div>
        <h1>{title}</h1>
        <table className='table table-hover table-inverse tw-report-table' style={{ whiteSpace: 'nowrap' }}>
          <thead>
            <tr>
              <th>AdGroup</th>
              <th>
                Total Cost
              </th>
              <th>
                Unique Visits
              </th>
              <th>
                Clicks
              </th>
              <th>
                Signups
              </th>
              <th>
                Licenses
              </th>
              <th>
                Cost / License
              </th>
              <th>
                Cost / Signup
              </th>
              <th>
                Churned
                <div className='details'>Licenses</div>
              </th>
              <th>
                MRR
                <div className='details'>Estimate</div>
              </th>
              <th>
                CR
                <div className='details'>Signup to Paid</div>
              </th>
              <th>
                CR
                <div className='details'>Visit to Paid</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {report.map((x, i) => (
              <AdGroupReportRow key={i} row={x} />
            ))}
            <AdGroupTotalRow report={report} />
          </tbody>
        </table>
      </div>
    )
  }
  render () {
    const { report } = this.props

    // Pick em.
    const adGroups = Object.keys(report.adGroup)
    adGroups.sort()
    const adGroupRows = adGroups
    .map(x => {
      const r = report.adGroup[x]
      r.adGroup = x
      return r
    })

    // Sort on number of total licenses desc, ad group name asc.
    adGroupRows.sort((a, b) => {
      if (a.totalLicenses === b.totalLicenses) {
        return a.adGroup < b.adGroup ? -1 : 1
      }
      return a.totalLicenses > b.totalLicenses ? -1 : 1
    })

    return (
      <div className='tw-report'>
        <div className='inner'>
          <hr/>
          {this.renderTable('AdGroup Report', adGroupRows)}
        </div>
      </div>
    )
  }
}

AdGroupReport.propTypes = {
  report: React.PropTypes.array.isRequired
}

const AdGroupReportRow = ({ row }) => {
  const style = { textAlign: 'right' }

  // An AdGroup is performing poorly when it has producted at least some signups
  // but yielded any licenses.
  const isPerformingPoorly = Math.floor(row.totalSignups * 0.025) && row.totalLicenses === 0

  const cls = classNames({
    'bg-warning': isPerformingPoorly
  })

  return (
    <tr className={cls}>
      <td>{row.adGroup}</td>
      <td style={style}>$ {round(row.totalCostPaidMarketing, 0).toLocaleString()}</td>
      <td style={style}>{row.totalUsers.toLocaleString()}</td>
      <td style={style}>{row.totalClicks.toLocaleString()}</td>
      <td style={style}>{row.totalSignups.toLocaleString()}</td>
      <td style={style}>{row.totalLicenses.toLocaleString()}</td>
      <td style={style}>$ {round(row.costPerLicenseAllChannels, 2).toLocaleString()}</td>
      <td style={style}>$ {round(row.costPerSignupPaidMarketing, 2).toLocaleString()}</td>
      <td style={style}>{round(row.totalLicensesChurned, 2).toLocaleString()}</td>
      <td style={style}>$ {round(row.averageLicenseCost * row.totalLicenses, 0).toLocaleString()}</td>
      <td style={style}>{row.conversionRateAllChannels} %</td>
      <td style={style}>{row.conversionRateUsers} %</td>
    </tr>
  )
}

const AdGroupTotalRow = ({ report }) => {
  const style = { textAlign: 'right' }

  const getTotal = (field) => report.reduce((acc, x) => acc + x[field], 0)
  const getAverage = (field) => {
    return (
      report.reduce((acc, x) => acc + Number(x[field]), 0) /
      (report.filter(x => Number(x[field])).length || 1)
    )
  }
  const getTotalMRR = () => report.reduce((acc, x) => acc + (x.averageLicenseCost * x.totalLicenses), 0)

  return (
    <tr style={{ backgroundColor: '#4cb992', color: 'white' }}>
      <td>Total</td>
      <td style={style}>$ {round(getTotal('totalCostPaidMarketing'), 0).toLocaleString()}</td>
      <td style={style}>{getTotal('totalUsers').toLocaleString()}</td>
      <td style={style}>{getTotal('totalClicks').toLocaleString()}</td>
      <td style={style}>{getTotal('totalSignups').toLocaleString()}</td>
      <td style={style}>{getTotal('totalLicenses').toLocaleString()}</td>

      <td style={style}>$ {round(getAverage('costPerLicenseAllChannels'), 2).toLocaleString()}</td>
      <td style={style}>$ {round(getAverage('costPerSignupPaidMarketing'), 2).toLocaleString()}</td>

      <td style={style}>{round(getAverage('totalLicensesChurned'), 2).toLocaleString()}</td>
      <td style={style}>$ {round(getTotalMRR(), 0).toLocaleString()}</td>

      <td style={style}>{round(getAverage('conversionRateAllChannels'), 2)} %</td>
      <td style={style}>{round(getAverage('conversionRateUsers'), 2)} %</td>
    </tr>
  )
}

ReactDOM.render(
  <section>
    <MonthlyReport report={reportData} />
    <AdGroupReport report={reportData} />
  </section>,
  document.getElementById('react-app')
)
