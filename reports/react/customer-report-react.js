/*
  global
  reportData,
*/
'use strict'
import React from 'react'
import moment from 'moment'
import { ReportRow } from './ReportRow.react'
import LicensesTableRow from './LicensesTableRow.react'
import { prepareData } from '../services/customerAdditionalDataService'
import ReactDOM from 'react-dom'

class App extends React.Component {
  constructor (props) {
    super(props)
    this.state = {
      data: props.data,
      rows: props.data.rows,
      dataFetched: false
    }
  }

  async componentDidMount () {
    await prepareData()
    this.setState({ dataFetched: true })
  }

  renderTableRows (report, opts) {
    return report.map((x, i) => (
      <ReportRow
        key={i}
        row={x}
        remaining={report.length - i}
        opts={opts}
      />
    ))
  }

  renderTable (title, report, opts = { }) {
    if (!this.state.dataFetched) {
      return (
        <div>
          <h1>{title} <i className='fa fa-circle-o-notch fa-spin' style={{ fontSize: '24px' }} /></h1>
        </div>
      )
    }
    return (
      <div>
        <h1>{title}</h1>
        <table className='table table-hover table-inverse tw-report-table'>
          <thead>
            <tr>
              <th>#</th>
              <th>Workspace Name</th>
              <th>Created</th>
              <th>Owner</th>
              <th>Subscription</th>
              <th>{opts.dateTitle ? opts.dateTitle : 'Start Date'}</th>
              <th>Payment Type</th>
              <th>Licenses</th>
              <th>Billing Cycle</th>
              <th>Payment Source</th>
              <th>Signup Source</th>
              <th>Channel</th>
              <th>Country</th>
              <th>Keyword</th>
              <th>Workspace ID</th>
              <th>Server</th>
            </tr>
          </thead>
          <tbody>
            {this.renderTableRows(report, opts)}
          </tbody>
        </table>
      </div>
    )
  }

  renderOverallStats (report) {
    return (
      <div>
        <table className='table table-hover table-bordered' style={{ width: 'auto' }}>
          <tbody>
            <tr>
              <td style={{ width: 300 }}>Licenses this Week:</td>
              <td style={{ width: 120 }} className='percentage'>{report.licensesThisWeek}</td>
              <td style={{ width: 300 }}>Average Revenue per License:</td>
              <td style={{ width: 120 }} className='percentage'>$ {report.averageLicenseCost.toFixed(2)}</td>
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
      <div>
        <table className='table table-hover table-bordered' style={{ width: 'auto' }}>
          <thead>
            <tr>
              <th>&nbsp;</th>
              {report.monthly.map((x, i) => (<th>{x.end}</th>))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ width: 300 }}>Churn Rate:</td>
              {report.monthly.map((x, i) => (
                <td className='percentage' style={{ width: 100 }}>
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
              <td>New Customers In Period:</td>
              {report.monthly.map((x, i) => (
                <td className='percentage' key={i}>
                  {x.customersInPeriod}
                  <div className='details'>{x.customersInPeriodGrowth.toFixed(2)}%</div>
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
              <td>License Price In Period:</td>
              {report.monthly.map((x, i) => {
                return (
                  <td className='percentage' key={i}>
                    ${x.licensePriceInPeriod.toFixed(1)}
                  </td>
                )
              })}
            </tr>
            <tr>
              <td>Lifetime Value of a License:</td>
              {report.monthly.map((x, i) => {
                return (
                  <td className='percentage' key={i}>
                    ${x.lifetimeValue.toFixed(0)}
                  </td>
                )
              })}
            </tr>
            <tr>
              <td>New Monthly Recurring Revenue:
                <div className='details'>
                  Valid from Oct 1st 2016.
                </div>
              </td>
              {report.monthly.map((x, i) => {
                if (x.start >= '2016-10-01') {
                  return (
                    <td className='percentage' key={i}>
                      ${x.monthlyRecurringRevenue.toLocaleString()}
                      <div className='details'>{x.monthlyRecurringRevenueGrowth.toFixed(2)}%</div>
                    </td>
                  )
                }
                return <td />
              })}
            </tr>
            <tr>
              <td>Total Sales Revenues in Period:</td>
              {report.monthly.map((x, i) => {
                if (x.start >= '2016-10-01') {
                  return (
                    <td className='percentage' key={i}>
                      ${x.monthlyRevenuesTotalInPeriod.toLocaleString()}
                      <div className='details'>M: ${x.salesMonthlyTotal.toLocaleString()} ({x.salesMonthlyPercentage}%)</div>
                      <div className='details'>A: ${x.salesAnnualTotal.toLocaleString()} ({x.salesAnnualPercentage}%)</div>
                    </td>
                  )
                }
                return <td />
              })}
            </tr>
            <tr>
              <td>Total Licenses In Period:</td>
              {report.monthly.map((x, i) => (
                <td className='percentage' key={i}>
                  {x.licensesInPeriodAccumulated}
                </td>
              ))}
            </tr>
            <LicensesTableRow report={report} />
          </tbody>
        </table>
      </div>
    )
  }

  render () {
    const { data } = this.state

    const churnedCustomersReport = this.state.rows
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

          <br />

          {this.renderTable(
            'Active Customers',
            this.state.rows.filter(x => x.isActive)
          )}

          <br />

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

ReactDOM.render(
  <App data={reportData} />,
  document.getElementById('react-app')
)
