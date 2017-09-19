const exec = require("child_process").exec

function execAsync (cmd, opts) {
  return new Promise((resolve) => {
    exec(cmd, opts, (err, msg) => {
      resolve(msg)
    })
  })
}

module.exports.execAsync = execAsync
