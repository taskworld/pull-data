import React from 'react'
import moment from 'moment'
import classNames from 'classnames'
import u from 'updeep'

import { getUsersData, writeUserData, prepareData } from '../services/customerAdditionalDataService'

class EditableField extends React.Component {

  onChange = (e) => {
    this.props.onChange(e)
  }

  onEdit = () => {
    this.props.onStartEditRow()
  }

  onKeyDown = (e) => {
    if (e.keyCode === 13) {
      this.props.onDoneEditRow(e.target.value)
    }
  }

  renderEditingState () {
    return (
      <input
        type='text'
        value={this.props.value}
        onChange={this.onChange}
        onKeyDown={this.onKeyDown}
      />
    )
  }

  renderNormalState () {
    const style = {
      cursor: 'pointer',
      textDecoration: 'underline',
      minWidth: '100px',
      minHeight: '24px',
    }
    return (
      <div style={style} onClick={this.props.onStartEditRow} className='clickable' >
        {this.props.value || ''}
      </div>
    )
  }

  render () {
    if (this.props.nonEditable) {
      return (
        <div>{this.props.value}</div>
      )
    }
    return (
      this.props.editting ? this.renderEditingState() : this.renderNormalState()
    )
  }
}

EditableField.propTypes = {
  editting: React.PropTypes.bool,
  nonEditable: React.PropTypes.bool,
  value: React.PropTypes.string
}

const defaultEditing = {
  signupSource: false,
  channel: false,
  country: false
}

export class ReportRow extends React.Component {

  constructor (props) {
    super(props)
    this.state = {
      row: props.row,
      editingField: {
        signupSource: false,
        channel: false,
        country: false
      }
    }
  }

  async componentDidMount () {
    const { row } = this.state
    if (!row.country || !row.signupSource || !row.channel) {
      const dataForRow = await getUsersData(row.workspaceId)
      if (!dataForRow) {
        return
      }
      const newRow = {
        ...row,
        ...dataForRow
      }
      this.setState({
        row: newRow
      })
    }
  }

  onStartEditRow = (field) => () => {

    this.setState({
      editingField: {
        ...defaultEditing,
        [field]: true
      }
    })
  }

  onDoneEditRow = async (field, val) => {
    const rowData = {
      ...this.state.row,
      [field]: val,
      month: moment(this.state.row.workspaceCreatedDate).month()
    }
    await writeUserData(this.state.row.workspaceId, rowData)
    this.setState({
      editingField: defaultEditing
    })
  }

  onEdit = (field, val) => {
    this.setState({
      row: {
        ...this.state.row,
        [field]: val
      }
    })
  }

  render () {
    const { remaining, opts } = this.props
    const { row } = this.state

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
      'row-red': !row.isActive
    })
    return (
      <tr>
        <td>{remaining}</td>
        <td>{row.workspaceDisplayName}</td>
        <td className='nowrap'>{moment(row.workspaceCreatedDate).format('YYYY-MM-DD')}</td>
        <td>
          <div>{row.ownerName}</div>
          <div className='details-big'>{row.ownerEmail}</div>
        </td>
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
        <td className={newCls}>
          <div>{row.licenses}</div>
          <div className='details'>${(Number(row.amount || 0)).toLocaleString()}</div>
        </td>
        <td className={newCls}>{row.billingCycle}</td>
        <td>{row.subscriptionId ? 'BrainTree' : 'Invoice'}</td>
        <td>
          <EditableField
            value={row.signupSource}
            editting={this.state.editingField.signupSource}
            nonEditable={!row.editableField.signupSource}
            onStartEditRow={this.onStartEditRow('signupSource')}
            onChange={(e) => this.onEdit('signupSource', e.target.value)}
            onDoneEditRow={(val) => this.onDoneEditRow('signupSource', val)}
          />
        </td>
        <td>
          <EditableField
            value={row.channel}
            nonEditable={!row.editableField.channel}
            editting={this.state.editingField.channel}
            onStartEditRow={this.onStartEditRow('channel')}
            onChange={(e) => this.onEdit('channel', e.target.value)}
            onDoneEditRow={(val) => this.onDoneEditRow('channel', val)}
          />
          <div className='details'>{row.device}</div>
        </td>
        <td>
          <EditableField
            value={row.country}
            nonEditable={!row.editableField.country}
            editting={this.state.editingField.country}
            onStartEditRow={this.onStartEditRow('country')}
            onChange={(e) => this.onEdit('country', e.target.value)}
            onDoneEditRow={(val) => this.onDoneEditRow('country', val)}
          />
        </td>
        <td><div className='details'>{row.workspaceId}</div></td>
      </tr>
    )
  }
}
