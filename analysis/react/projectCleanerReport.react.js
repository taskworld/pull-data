/* global reportData, moment, React, ReactDOM */
'use strict'

const styles = {
  left: { textAlign: 'left' },
  right: { textAlign: 'right' },
  photo: {
    width: 30,
    height: 30,
    borderRadius: 30,
    marginRight: 8
  }
}

const ReportTable = ({ title, report }) => (
  <div className='everything-centered'>
    <h1>{title}</h1>
    <table className='table table-hover table-inverse tw-report-table'>
      <thead>
        <tr>
          <th>#</th>
          <th>Project</th>
          <th>Last Activity</th>
          <th>Tasklists</th>
          <th>Owner</th>
          <th>Members</th>
          <th>
            <div>Total Activity</div>
            <div className='details'></div>
          </th>
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

const ReportRow = ({ row, remaining }) => (
  <tr>
    <td>{remaining}</td>
    <td style={styles.left}>{row.project.title}</td>
    <td>{moment(row.last_event).format('YYYY-MM-DD')}</td>
    <td>{row.project.tasklists.length}</td>
    <td style={styles.left}>
      <img style={styles.photo} src={row.project.owner.photo} />
      {row.project.owner.first_name} {row.project.owner.last_name}
    </td>
    <td>
      {row.project.members.length}
    </td>
    <td>{row.event_count}</td>
  </tr>
)

class App extends React.Component {
  render () {
    const { report } = this.props
    return (
      <div className='tw-report'>
        <div className='inner'>
          <ReportTable title='Cleanup Projects' report={report}/>
        </div>
      </div>
    )
  }
}

App.propTypes = {
  report: React.PropTypes.object.isRequired
}

ReactDOM.render(
  <App report={reportData} />,
  document.getElementById('react-app')
)
