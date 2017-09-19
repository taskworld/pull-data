const Path = require('path')

module.exports = {
  entry: './reports/react/index.js',
  output: {
    path: Path.join(__dirname, './bin/'),
    filename: 'app.bundle.js'
  },
  module: {
    loaders: [
      { test: /\.js$/, loader: 'babel-loader', exclude: /node_modules/ },
      { test: /\.jsx$/, loader: 'babel-loader', exclude: /node_modules/ }
    ]
  }
}
