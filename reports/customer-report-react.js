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
  let startingMonth = moment().subtract(4, 'months')
  if (startingMonth.isBefore(moment('2016-05-01'))) {
    startingMonth = moment('2016-05-01')
  }
  return getChurnRatePerMonth(startingMonth, 4)
}

function getLicensesAfter (date) {
  return reportData
  .filter((x) => x.subscription === 'premium')
  .filter((x) => moment(x.subscriptionStartDate).isAfter(date))
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)
}

function getChurnRatePerMonth (startMonth, numMonths) {
  return range(numMonths).map((month) => {
    const start = startMonth.clone()
    .add(month, 'months')
    .startOf('month')
    const end = start.clone().endOf('month')
    const churn = getChurnRateForPeriod(start, end)
    return {
      start,
      end,
      churnRate: churn.churnRate,
      newLicenses: churn.newLicenses
    }
  })
}

function getChurnRateForPeriod (startDate, endDate) {
  const newLicenses = reportData
  .filter((x) => x.subscription === 'premium')
  .filter((x) => moment(x.subscriptionStartDate).isBetween(startDate, endDate))
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  const churnedLicenses = reportData
  .filter((x) => x.subscription === 'canceled')
  .filter((x) => moment(x.subscriptionStartDate).isBetween(startDate, endDate))
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  console.log(`Churn rate in month ${startDate.format('YYYY-MM')}: ${churnedLicenses} churned / ${newLicenses} new licenses.`)
  return {
    churnedLicenses,
    newLicenses,
    churnRate: churnedLicenses / newLicenses * 100
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
  render () {
    const { report, churn } = this.props
    const period =
      churn[0].start.format('MMM') +
      ' - ' +
      churn[churn.length - 1].end.format('MMM YYYY')

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
              <td>Churn Rate ({period}):</td>
              <td>{churn.map((x, i) => (
                <span className='percentage' key={i}>{x.churnRate.toFixed(2)}%</span>
              ))}</td>
            </tr>
            <tr>
              <td>Licenses per Month ({period}):</td>
              <td>{churn.map((x, i) => (
                <span className='percentage' key={i}>{x.newLicenses}</span>
              ))}</td>
            </tr>
          </table>

          <hr/>

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
              </tr>
            </thead>
            <tbody>
              {report.map((x, i) => (
                <ReportRow key={i} row={x} remaining={report.length - i} />
              ))}
            </tbody>
          </table>
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
  const isNew = moment(row.subscriptionStartDate).isAfter(moment().subtract(2, 'days'))
  const cls = classNames({
    'bg-danger': row.subscription === 'canceled'
  })
  return (
    <tr className={cls}>
      <td>{remaining}</td>
      <td>{row.workspaceDisplayName}</td>
      <td className='nowrap'>{moment(row.workspaceCreatedDate).format('YYYY-MM-DD')}</td>
      <td>{row.ownerName}</td>
      <td>{row.ownerEmail}</td>
      <td>{row.subscription}</td>
      <td className='nowrap'>{moment(row.subscriptionStartDate).format('YYYY-MM-DD')}</td>
      <td>{row.paymentType}</td>
      <td className={isNew ? 'new-row' : ''}>{row.licenses}</td>
      <td className={isNew ? 'new-row' : ''}>{row.billingCycle}</td>
      <td className='nowrap'>{row.subscriptionId ? 'BrainTree' : 'PayPal Invoice'}</td>
    </tr>
  )
}

ReactDOM.render(
  <App report={reportData} churn={getChurnRates()} />,
  document.getElementById('react-app')
)
