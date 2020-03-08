const express = require('express')
const bodyParser = require('body-parser')
const { check, validationResult, param } = require('express-validator')
const { spawn, exec } = require('child_process')
const app = express()
const argv = require('yargs').argv
const port = argv.port || 3000
const directory = argv.port || '.'
const bncli =  './tbnbcli'
const chainId = 'Binance-Chain-Nile'
const node = 'https://data-seed-pre-0-s1.binance.org:443'
const pty = require('node-pty')

const middleware = [
  bodyParser.json(),
  bodyParser.urlencoded({ extended: true }),
  check()
]

app.use(middleware)

app.get('/', (req, res) => {
  res.send('live')
})

const initCheck = [
  check('home').exists().trim().escape(),
  check('vault').exists().trim().escape(),
  check('moniker').exists().trim().escape(),
  check('password').exists().trim().isLength({ min:9 }),
  check('override').optional().isBoolean()
]

app.post('/init', initCheck, (req, res) => {
  try{
    const errors = validationResult(req)
    if(!errors.isEmpty())
      return res.status(422).json({ errors: errors.array() })

    const { home, vault, moniker, password, override } = req.body
    let overrideOption = "n"

    if(override)
      overrideOption = "y"

    const echo = spawn("echo", ["-e", overrideOption])

    const tssInit = spawn("./tss", ["init", "--home", "."+home, "--vault_name", vault, "--moniker", moniker, "--password", password])
    echo.stdout.pipe(tssInit.stdin)

    tssInit.stdout.on("data", function (data) {
      console.log("init spawnSTDOUT:", data.toString())
      const response = data.toString().indexOf("nothing happened");

      if(response !== -1){
        return res.status(400).send("Home and vault already exist. Nothing happened. To override set override param to true")
      }else{
        return res.status(200).send(data.toString())
      }
    })

    tssInit.stderr.on("data", function (data) { //tss init returns result as error
      console.log("init spawnSTDERR:", data.toString())
      const success = data.toString().indexOf("Local party has been initialized")

      if(success !== -1){
        return res.status(200).send("Local party has been initialized")
      }else{
        if(!res.headersSent)
          return res.status(400).send(data.toString())
      }
    })
  }catch(error){
    return res.status(500).send(error.message)
  }
})

const channelCheck = [
  check('expiration').optional().isInt({ min:1 })
]

app.post('/channel', channelCheck, (req, res) => {
  try{
    const errors = validationResult(req)
    if(!errors.isEmpty())
      return res.status(422).json({ errors: errors.array() })

    let { expiration } = req.body

    if(!expiration){
      expiration = 30 //default value of tss channel
    }

    const tssChannel = spawn("./tss", ["channel", "--channel_expire", expiration])

    tssChannel.stdout.on("data", function (data) {
      console.log("channel spawnSTDOUT:", data.toString())
      const success = data.toString().indexOf("channel id: ")

      if(success !== -1){
       const channelId = data.toString().substring(success+12).trim()
       return res.status(200).send({channelId: channelId})
      }else{
       return res.status(200).send(data.toString())
      }
    });

    tssChannel.stderr.on("data", function (data) {
      console.log("channel spawnSTDERR:", data.toString())
      if(!res.headersSent)
        return res.status(500).send(data.toString())
    });
  }catch(error){
    return res.status(500).send(error.message)
  }
})

const keygenCheck = [
  check('home').exists().trim().escape(),
  check('vault').exists().trim().escape(),
  check('parties').exists().isInt({ min:2 }),
  check('threshold').exists().isInt({ min:1 }),
  check('password').exists().trim().isLength({ min:9 }),
  check('channelPassword').exists().trim().isLength({ min:9 }),
  check('channelId').exists().trim().escape(),
  check('moniker').exists().trim().escape() //Used to recover the address  after keygen
]

app.post('/keygen', (req, res) => {
  try{
    const errors = validationResult(req)
    if(!errors.isEmpty())
      return res.status(422).json({ errors: errors.array() })

    res.setTimeout(600000);

    const { home, vault, parties, threshold, password, channelPassword, channelId, moniker } = req.body

    const tssKeygen = spawn("./tss", ["keygen", "--home", "."+home, "--vault_name", vault, "--parties", parties, "--threshold", threshold, "--password", password, "--channel_password", channelPassword, "--channel_id", channelId]);

    tssKeygen.stdout.on("data", function (data) {
      console.log("keygen spawnSTDOUT:", data.toString())
    });

    tssKeygen.stderr.on("data", function (data) {//added message print as error
      console.log("keygen spawnSTDERR:", data.toString())
      const success = data.toString().indexOf("added tss_")

      if(success !== -1){
        console.log("Successfully added tss to bnbcli's default keystore")
        const keyName = "tss_"+moniker+"_"+vault

        exec(bncli+" keys show "+keyName+" | awk '{ print $3; }' | sed -n 2p", (error, stdout, stderr) => {
          if (error) {
              console.log(`error: ${error.message}`);
          }
          if (stderr) {
              console.log(`stderr: ${stderr}`);
          }
          return res.status(200).send({address: stdout.toString().trim()})
          console.log(`stdout: ${stdout}`);
        });
      }
    });
  }catch(error){
    return res.status(500).send(error.message)
  }
})

const signCheck = [
  check('vault').exists().trim().escape(),
  check('password').exists().trim().isLength({ min:9 }),
  check('channelPassword').exists().trim().isLength({ min:9 }),
  check('channelId').exists().trim().escape(),
  check('moniker').exists().trim().escape(), //Used to recover the address  after keygen
  check('amount').exists().trim().escape(),
  check('asset').exists().trim().escape(),
  check('to').exists().trim().escape()
]

app.post('/sign', signCheck, (req, res) => {
  try{
    const errors = validationResult(req)
    if(!errors.isEmpty())
      return res.status(422).json({ errors: errors.array() })


    res.setTimeout(600000);

    const { vault, moniker, password, channelPassword, channelId,  amount, asset, to } = req.body

    const keyName = "tss_"+moniker+"_"+vault

    const passCMD= password.toString().trim()
    const passChannelCMD = channelPassword.toString().trim()
    const idChannelEchoCMD = channelId.toString().trim()

    const tbnCMD = bncli+" send "+"--amount "+amount+":"+asset+" --to "+to+" --from "+keyName+" --chain-id "+chainId+" --node "+node+" --trust-node"
    var os = require('os');
    var pty = require('node-pty');

    var shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

    var ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      env: process.env
    });

    ptyProcess.on('data', function(data) {
      process.stdout.write(data);
    });

    ptyProcess.write(tbnCMD+'\r');
    ptyProcess.write(passCMD+'\r');
    ptyProcess.write(idChannelEchoCMD+'\r');
    ptyProcess.write(passChannelCMD+'\r');

    ptyProcess.on('exit', function(data) {
      return res.status(200).send("signing finished!")
    });
    ptyProcess.write('exit\r');

  }catch(error){
    return res.status(500).send(error.message)
  }
})

const signCheck3 = [
  check('vault').exists().trim().escape(),
  check('password').exists().trim().isLength({ min:9 }),
  check('channelPassword').exists().trim().isLength({ min:9 }),
  check('channelId').exists().trim().escape(),
  check('moniker').exists().trim().escape(), //Used to recover the address  after keygen
  check('amount1').exists().trim().escape(),
  check('asset1').exists().trim().escape(),
  check('to1').exists().trim().escape(),
  check('amount2').exists().trim().escape(),
  check('asset2').exists().trim().escape(),
  check('to2').exists().trim().escape(),
  check('amount3').exists().trim().escape(),
  check('asset3').exists().trim().escape(),
  check('to3').exists().trim().escape()
]

app.post('/sign3', signCheck3, (req, res) => {
  try{
    const errors = validationResult(req)
    if(!errors.isEmpty())
      return res.status(422).json({ errors: errors.array() })


    res.setTimeout(600000);

    const { vault, moniker, password, channelPassword, channelId, amount1, asset1, to1, amount2, asset2, to2, amount3, asset3, to3 } = req.body

    const keyName = "tss_"+moniker+"_"+vault

    const passCMD= password.toString().trim()
    const passChannelCMD = channelPassword.toString().trim()
    const idChannelEchoCMD = channelId.toString().trim()

//./tbnbcli token multi-send --home ./testnodecli --from test --chain-id=Binance-Chain-Nile --node=data-seed-pre-2-s1.binance.org:80  --transfers "[{\"to\":\"tbnb1sylyjw032eajr9cyllp26n04300qzzre38qyv5\",\"amount\":\"100000000000000:BNB\"},{\"to\":\"tbnb1e244vmvym7g6cn9lk4hmhf9p2f9jaf0x9hxmwc\",\"amount\":\"100000000000000:BNB\"}]" --json
    const txJson =  '\"[{\\\"to\\\":\\\"'+to1+'\\\",\\\"amount\\\":\\\"'+amount1+':'+asset1+'\\\"},{\\\"to\\\":\\\"'+to2+'\\\",\\\"amount\\\":\\\"'+amount2+':'+asset2+'\\\"},{\\\"to\\\":\\\"'+to3+'\\\",\\\"amount\\\":\\\"'+amount3+':'+asset3+'\\\"}]\"'
    const tbnCMD = bncli+" token multi-send --from "+keyName+" --chain-id "+chainId+" --node "+node+" --trust-node --transfers "+txJson+" --json"
    var os = require('os');
    var pty = require('node-pty');

    var shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

    var ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      env: process.env
    });

    ptyProcess.on('data', function(data) {
      process.stdout.write(data);
    });

    ptyProcess.write(tbnCMD+'\r');
    ptyProcess.write(passCMD+'\r');
    ptyProcess.write(idChannelEchoCMD+'\r');
    ptyProcess.write(passChannelCMD+'\r');

    ptyProcess.on('exit', function(data) {
      return res.status(200).send("signing finished!")
    });
    ptyProcess.write('exit\r');

  }catch(error){
    return res.status(500).send(error.message)
  }
})

app.listen(port, () => console.log(`Server listening on port ${port}!`))
