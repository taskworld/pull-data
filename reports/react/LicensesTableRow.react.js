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
    if (!userRow.country) return acc
    if (!thisMonthData[userRow.country]) {
      thisMonthData[userRow.country] = 0
    }
    thisMonthData[userRow.country] += (userRow.licenses || 1)
    return acc
  }, { })

  const mergedData = monthly.reduce((acc, row, i) => {
    const thisMonth = moment(row.endOfLastPeriod).month() + 1
    const monthDataFromUser = dataFromUser[thisMonth] || { }
    const valueFromUserReportPerCountry = row.countries.reduce((acc, y) => {
      const name = y[0]
      const value = y[1]
      acc[name] = value
      return acc
    }, { })
    const allCountries = Array.from(new Set(row.countries.map(c => c[0]).concat(Object.keys(monthDataFromUser))))
    const customInputCountryCount = Object.keys(monthDataFromUser).reduce((acc, key) => {
      return acc + monthDataFromUser[key]
    }, 0)
    const data = {
      key: i,
      countries: allCountries.map(countryName => {
        const valueFromReport = valueFromUserReportPerCountry[countryName] || 0
        if (countryName === 'Other') {
          // Hack: This is obvious hack
          // We should compare it row by row instead
          const value = valueFromReport - customInputCountryCount
          return { name: countryName, value: Math.max(value, 0) }
        }
        const valueFromUserData = monthDataFromUser[countryName] || 0
        return {
          name: countryName, value: valueFromReport + valueFromUserData
        }
      }).sort((a, b) => b.value > a.value ? 1 : -1),
      month: thisMonth
    }
    acc.push(data)
    return acc
  }, [])
  return mergedData
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
