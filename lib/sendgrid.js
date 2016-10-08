'use strict'

const Fs = require('fs')
const Path = require('path')
const Helper = require('sendgrid').mail
const Zlib = require('zlib')

function sendEmail (opts = { }) {
  const Sg = require('sendgrid')(process.env.SENDGRID_API_KEY)

  const fromEmail = new Helper.Email(opts.from)
  const toEmail = new Helper.Email(opts.to)
  const subject = opts.subject || 'Some Subject (That’s Missing).'
  const content = new Helper.Content('text/plain', opts.body || 'Some Content (That’s Missing).')
  const mail = new Helper.Mail(fromEmail, subject, toEmail, content)

  if (opts.files) {
    opts.files.forEach(file => {
      const fileContents = Fs.readFileSync(file.path, 'utf8')
      const contentLength = Buffer.from(fileContents).length
      const zippedBuffer = Zlib.gzipSync(Buffer.from(fileContents))
      console.log(`Compressed ${file.path}: ${contentLength} -> ${zippedBuffer.length} bytes`)

      const attachment = new Helper.Attachment()
      attachment.setContent(zippedBuffer.toString('base64'))
      // attachment.setType(file.mime)
      attachment.setType('application/x-gzip')
      attachment.setFilename(Path.basename(file.path) + '.gz')
      attachment.setDisposition('attachment')
      mail.addAttachment(attachment)
    })
  }

  const request = Sg.emptyRequest({
    method: 'POST',
    path: '/v3/mail/send',
    body: mail.toJSON()
  })

  console.log(`
  Sending email.
  To:          ${request.body.personalizations[0].to[0].email}
  Subject:     ${request.body.subject}
  Content:     ${request.body.content[0].value}
  Attachments: ${request.body.attachments.map(x => x.filename).join(', ')}
  `)
  return Sg.API(request)
}

module.exports = {
  sendEmail
}
