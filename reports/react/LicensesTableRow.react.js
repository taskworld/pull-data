import React from 'react'
import { getAllData } from '../services/customerAdditionalDataService'
import moment from 'moment'

function getMonthlyData (monthly, userData) {
  userData = userData || { }
  const dataFromUser = Object.values(userData).reduce((acc, userRow) => {
    const month = userRow.month
    if (month === null || month === undefined) {
      return acc
    }
    if (!acc[month]) {
      acc[month] = { }
    }
    const thisMonthData = acc[month]
    if (!thisMonthData[userRow.country]) {
      thisMonthData[userRow.country] = 0
    }
    thisMonthData[userRow.country] += 1
    return acc
  }, { })
  const dataFromReport = monthly.reduce((acc, row, i) => {
    const thisMonth = moment(row.endOfLastPeriod).month()
    let thisMonthRemoveCountryCount = 0
    const data = {
      key: i,
      countries: row.countries.map(y => {
        const name = y[0]
        const countReport = y[1]
        if (name === 'Other') {
          return { name, value: countReport - thisMonthRemoveCountryCount }
        }
        const countUserData = dataFromUser[thisMonth] || { }
        const countUserDataForThisCountry = countUserData[name] || 0
        const value = countReport + countUserDataForThisCountry
        thisMonthRemoveCountryCount += countUserDataForThisCountry
        return {
          name, value
        }
      }),
      month: thisMonth
    }
    acc.push(data)
    return acc
  }, [])
  return dataFromReport
}

export default class LicensesTableRow extends React.Component {
  constructor (props) {
    super(props)
    this.state = {
      report: props.report,
      userData: null
    }
  }

  async componentDidMount () {
    const userData = await getAllData()
    this.setState({
      userData
    })
  }

  render () {
    const monthData = getMonthlyData(this.state.report.monthly, this.state.userData)
    return (
      <tr>
        <td>Licenses by Country:</td>
        {monthData.map(m => (
          <td className='percentage' key={m.key}>
            {m.countries.map(country => {
              return (
                <div className='details'>{country.name}:{country.value}</div>
              )
            })}
          </td>
        ))}
      </tr>
    )
  }
}

LicensesTableRow.propTypes = {
  report: React.PropTypes.object
}
