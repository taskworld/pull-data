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
        <table className='table table-hover table-inverse tw-report-table'>
          <thead>
            <tr>
              <th>#</th>
              <th>Workspace Name</th>
              <th>Created</th>
              <th>Owner Name</th>
              <th>Owner Email</th>
              <th>Subscription</th>
              <th>{opts.dateTitle ? opts.dateTitle : 'Start Date'}</th>
              <th>Payment Type</th>
              <th>Licenses</th>
              <th>Billing Cycle</th>
              <th>Payment Source</th>
              <th>Signup Source</th>
              <th>Channel</th>
              <th>Country</th>
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

  renderOverallStats (report) {
    return (
      <div style={{ width: 800 }}>
        <table className='table table-hover table-bordered'>
          <tbody>
            <tr>
              <td>Licenses this Week:</td>
              <td className='percentage'>{report.licensesThisWeek}</td>
              <td>Average Cost per License:</td>
              <td className='percentage'>$ {report.averageLicenseCost.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Licenses in {moment().format('MMM YYYY')}:</td>
              <td className='percentage'>{report.licensesThisMonth}</td>
              <td>Potential Lifetime Value per License:</td>
              <td className='percentage'>
                $ {(report.averageLicenseCost / report.churnRateMonthlyAverage).toFixed(2)}
              </td>
            </tr>
            <tr>
              <td>Total Active Licenses:</td>
              <td className='percentage'>{report.licensesTotal}</td>
            </tr>
            <tr>
              <td>Average Days from Trial to Purchase:</td>
              <td className='percentage'>{report.averagePurchaseTimeDays}</td>
            </tr>
            <tr>
              <td>Average Monthly License Churn Rate:</td>
              <td className='percentage'>
                {(report.churnRateMonthlyAverage * 100).toFixed(2)}% &nbsp;/&nbsp;
                {(report.churnRateOptimisticMonthlyAverage * 100).toFixed(2)}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  renderMonthlyStats (report) {
    return (
      <div style={{ width: 1000 }}>
        <table className='table table-hover table-bordered'>
          <thead>
            <tr>
              <th>&nbsp;</th>
              {report.monthly.map((x, i) => (<th>{x.end}</th>))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Churn Rate:</td>
              {report.monthly.map((x, i) => (
                <td className='percentage'>
                  {(x.churnRate * 100).toFixed(2)}%
                </td>
              ))}
            </tr>
            <tr>
              <td>Churned Licenses:</td>
              {report.monthly.map((x, i) => (
                <td className='percentage'>
                  {x.churnedLicensesInPeriod}
                </td>
              ))}
            </tr>
            <tr>
              <td>
                <div>Churn Rate (Real Customers):</div>
                <div className='details'>
                  Customers who have been with us more than 45 days.
                </div>
              </td>
              {report.monthly.map((x, i) => (
                <td className='percentage'>
                  {(x.churnRateOptimistic * 100).toFixed(2)}%
                </td>
              ))}
            </tr>
            <tr>
              <td>Churned Licenses (Real Customers):</td>
              {report.monthly.map((x, i) => (
                <td className='percentage'>
                  {x.churnedLicensesFromRealCustomersInPeriod}
                </td>
              ))}
            </tr>
            <tr>
              <td>New Licenses Sold In Period:</td>
              {report.monthly.map((x, i) => (
                <td className='percentage' key={i}>
                  {x.licensesInPeriod}
                </td>
              ))}
            </tr>
            <tr>
              <td>Total Licenses Active Before Period:</td>
              {report.monthly.map((x, i) => (
                <td className='percentage' key={i}>
                  {x.licensesBeforePeriod}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  render () {
    const { data } = this.props

    const churnedCustomersReport = data.rows
    .filter(x => !x.isActive)
    .map(x => {
      const copy = { ...x }
      copy.secondaryDate = moment(x.subscriptionEndDate, 'YYYY-MM-DD')
      return copy
    })
    // Resort on secondaryDate desc.
    churnedCustomersReport.sort((a, b) => a.secondaryDate < b.secondaryDate ? 1 : -1)

    return (
      <div className='tw-report'>
        <div className='inner'>
          {this.renderOverallStats(data.report)}
          {this.renderMonthlyStats(data.report)}

          <br/>

          {this.renderTable(
            'Active Customers',
            data.rows.filter(x => x.isActive)
          )}

          <br/>

          {this.renderTable(
            'Churned Customers',
            churnedCustomersReport,
            { dateTitle: 'Lockout Date' }
          )}
        </div>
      </div>
    )
  }
}

App.propTypes = {
  data: React.PropTypes.object.isRequired
}

const ReportRow = ({ row, remaining, opts }) => {
  let isBeforeToday = moment(row.subscriptionStartDate).isBefore(
    moment().startOf('day')
  )
  const isWithinToday = moment(row.subscriptionStartDate).isAfter(
    moment().startOf('day')
  )
  const isWithin48Hours = moment(row.subscriptionStartDate).isAfter(
    moment().subtract(2, 'days').startOf('day')
  )

  if (row.secondaryDate) {
    isBeforeToday = row.secondaryDate.isBefore(moment().startOf('day'))
  }

  const newCls = classNames({
    'nowrap': true,
    'row-green': isWithinToday,
    'row-amber': !isWithinToday && isWithin48Hours,
    'row-red': !row.isActive
  })

  return (
    <tr>
      <td>{remaining}</td>
      <td>{row.workspaceDisplayName}</td>
      <td className='nowrap'>{moment(row.workspaceCreatedDate).format('YYYY-MM-DD')}</td>
      <td>{row.ownerName}</td>
      <td>{row.ownerEmail}</td>
      <td>
        <div>{row.subscription}</div>
        <div className='details'>{row.membershipDays} days</div>
      </td>
      <td className={newCls}>
        {row.secondaryDate
          ? row.secondaryDate.format('YYYY-MM-DD')
          : moment(row.subscriptionStartDate).format('YYYY-MM-DD')
        }
        <div className='details'>{moment(row.subscriptionEndDate).format('YYYY-MM-DD')}</div>
      </td>
      <td>{row.paymentType}</td>
      <td className={newCls}>{row.licenses}</td>
      <td className={newCls}>{row.billingCycle}</td>
      <td>{row.subscriptionId ? 'BrainTree' : 'Invoice'}</td>
      <td>{row.signupSource}</td>
      <td>{row.channel}</td>
      <td>{row.country}</td>
    </tr>
  )
}

ReactDOM.render(
  <App data={reportData} />,
  document.getElementById('react-app')
)
