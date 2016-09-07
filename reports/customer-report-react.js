/*
  global
  reportData, moment, React, ReactDOM, classNames
*/
'use strict'

function range (num) {
  return [ ...new Array(num) ].map((x, i) => i)
}

function getTotalLicenses () {
  return reportData
  .filter((x) => x.subscription === 'premium')
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)
}

function getChurnRates () {
  let startMonth = moment().subtract(4, 'months')
  if (startMonth.isBefore(moment('2016-05-01'))) {
    startMonth = moment('2016-05-01')
  }
  return getChurnRatePerMonth(startMonth, 4)
}

function getLicensesAfter (date) {
  return reportData
  .filter((x) => x.subscription === 'premium')
  .filter((x) => moment(x.subscriptionStartDate).isAfter(date))
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)
}

function getChurnRatePerMonth (startMonth, numMonths) {
  console.log('Starting from month:', startMonth.format())
  return range(numMonths + 1).map((month) => {
    const start = startMonth.clone()
    .add(month, 'months')
    .startOf('month')
    const end = start.clone().endOf('month')
    const churn = getChurnRateForPeriod(start, end)

    return {
      start,
      end,
      endOfLastPeriod: start.clone().subtract(1, 'second'),
      churnRate: churn.churnRate,
      newInPeriod: churn.newInPeriod,
      accumulatedBeforePeriod: churn.accumulatedBeforePeriod
    }
  })
}

function getChurnRateForPeriod (startDate, endDate) {
  const accumulatedBeforePeriod = reportData
  .filter((x) => x.subscription === 'premium')
  .filter((x) => moment(x.subscriptionStartDate).isBefore(startDate))
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  const newInPeriod = reportData
  .filter((x) => x.subscription === 'premium')
  .filter((x) => moment(x.subscriptionStartDate).isBetween(startDate, endDate))
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  const churned = reportData
  .filter((x) => x.subscription === 'canceled')
  .filter((x) => moment(x.subscriptionEndDate).isBetween(startDate, endDate))
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  console.log(
    `Churn rate in period ${startDate.format()} - ${endDate.format()}: ` +
    `${churned} churned / ${accumulatedBeforePeriod} acculmulated licenses before period.`
  )
  return {
    churned,
    newInPeriod,
    accumulatedBeforePeriod,
    churnRate: accumulatedBeforePeriod ? (churned / accumulatedBeforePeriod * 100) : 0
  }
}

function getAveragePurchaseTimeInDays () {
  const rows = reportData
  .filter((x) => x.subscription === 'premium')
  .filter((x) => (
    moment(x.subscriptionStartDate).isAfter(moment('2016-05-01')) &&
    moment(x.workspaceCreatedDate).isAfter(moment('2016-05-01'))
  ))

  return rows
  .reduce((acc, x) => {
    const startDate = moment(x.workspaceCreatedDate)
    const endDate = moment(x.subscriptionStartDate)
    const duration = moment.duration(endDate.diff(startDate))
    const days = duration.asDays()
    return acc + days
  }, 0) / rows.length
}

class App extends React.Component {
  renderTable (title, report) {
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
              <th>Start Date</th>
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
              <ReportRow key={i} row={x} remaining={report.length - i} />
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  render () {
    const { report, churn } = this.props
    return (
      <div className='tw-report'>
        <div className='inner'>
          <table className='stats'>
            <tr>
              <td>Licenses this Week:</td>
              <td>{getLicensesAfter(moment().startOf('week'))}</td>
            </tr>
            <tr>
              <td>Licenses in {moment().format('MMM YYYY')}:</td>
              <td>{getLicensesAfter(moment().startOf('month'))}</td>
            </tr>
            <tr>
              <td>Total Active Licenses:</td>
              <td>{getTotalLicenses()}</td>
            </tr>
            <tr>
              <td>Average Days from Trial to Purchase:</td>
              <td>{getAveragePurchaseTimeInDays().toFixed(2)}</td>
            </tr>
            <tr>
              <td>Churn Rate:</td>
              <td>
                {churn.map((x, i) => (
                  <span className='percentage'>
                    <span className='month'>{x.start.format('MMM')}:</span>
                    {x.churnRate.toFixed(2)}%
                  </span>
                ))}
              </td>
            </tr>
            <tr>
              <td>New Licenses per Month:</td>
              <td>{churn.map((x, i) => (
                <span className='percentage' key={i}>
                  <span className='month'>{x.start.format('MMM')}:</span>
                  {x.newInPeriod}
                </span>
              ))}</td>
            </tr>
            <tr>
              <td>Accumulated Licenses:</td>
              <td>{churn.map((x, i) => (
                <span className='percentage' key={i}>
                  <span className='month'>{x.endOfLastPeriod.format('MMM')}:</span>
                  {x.accumulatedBeforePeriod}
                </span>
              ))}</td>
            </tr>
          </table>

          <hr/>

          {this.renderTable(
            'Active Customers',
            report.filter(x => x.subscription === 'premium')
          )}

          <hr/>

          {this.renderTable(
            'Churned Customers',
            report.filter(x => x.subscription !== 'premium')
          )}
        </div>
      </div>
    )
  }
}

App.propTypes = {
  report: React.PropTypes.array.isRequired,
  churn: React.PropTypes.array.isRequired
}

const ReportRow = ({ row, remaining }) => {
  const isWithinToday = moment(row.subscriptionStartDate).isAfter(
    moment().startOf('day')
  )
  const isWithin48Hours = moment(row.subscriptionStartDate).isAfter(
    moment().subtract(2, 'days').startOf('day')
  )

  const newCls = classNames({
    'nowrap': true,
    'row-green': isWithinToday,
    'row-amber': !isWithinToday && isWithin48Hours,
    'row-red': row.subscription === 'canceled'
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
      <td className={newCls}>{moment(row.subscriptionStartDate).format('YYYY-MM-DD')}</td>
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
  <App report={reportData} churn={getChurnRates()} />,
  document.getElementById('react-app')
)
