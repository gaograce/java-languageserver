const cp = require("child_process")
const express = require("express")
const glob = require("glob")
const WebSocket = require("ws").WebSocket
const url = require("url")

const CONFIG_DIR = process.platform === 'darwin' ? 'config_mac' : process.platform === 'linux' ? 'config_linux' : 'config_win'
const BASE_URI = '/opt/jdt-language-server'

const PORT = 5036

const launchersFound = glob.sync('**/plugins/org.eclipse.equinox.launcher_*.jar', {cwd: `${BASE_URI}`})
if (launchersFound.length === 0 || !launchersFound) {
    throw new Error('**/plugins/org.eclipse.equinox.launcher_*.jar Not Found!')
}
const params =
    [
        '-Xmx1G',
        '-Xms1G',
        //'-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=,quiet=y',
        '-Declipse.application=org.eclipse.jdt.ls.core.id1',
        '-Dosgi.bundles.defaultStartLevel=4',
        '-Dlog.level=ALL',
        //'-noverify',
        '-Declipse.product=org.eclipse.jdt.ls.core.product',
        '-jar',
        `${BASE_URI}/${launchersFound[0]}`,
        '-configuration',
        `${BASE_URI}/${CONFIG_DIR}`
    ]

let app = express()
let server = app.listen(PORT)
let ws = new WebSocket.Server({
    noServer: true,
    perMessageDeflate: false
})
server.on('upgrade', function (request, socket, head) {
    let pathname = request.url ? url.parse(request.url).pathname : undefined
    console.log(pathname)
    if (pathname === '/java-lsp') {
        ws.handleUpgrade(request, socket, head, function (webSocket) {
            let lspSocket = {
                send: function (content) {
                    return webSocket.send(content, function (error) {
                        if (error) {
                            throw error
                        }
                    })
                },
                onMessage: function (cb) {
                    return webSocket.on('message', cb)
                },
                onError: function (cb) {
                    return webSocket.on('error', cb)
                },
                onClose: function (cb) {
                    return webSocket.on('close', cb)
                },
                dispose: function () {
                    return webSocket.close()
                }
            }
            if (webSocket.readyState === webSocket.OPEN) {
                launch(lspSocket)
            } else {
                webSocket.on('open', function () {
                    return launch(lspSocket)
                })
            }
        })
    }
})

function launch(socket) {
    let process = cp.spawn('java', params)
    let data = ''
    let left = 0, start = 0, last = 0
    process.stdin.setEncoding('utf-8')
    socket.onMessage(function (data) {
        console.log(`Receive：${data.toString()}`)
        process.stdin.write('Content-Length: ' + data.length + '\n\n')
        process.stdin.write(data.toString())
    })
    socket.onClose(function () {
        console.log('Socket Closed')
        process.kill()
    })
    process.stdout.on('data', function (respose) {
        data += respose.toString()
        let end = 0
        for(let i = last; i < data.length; i++) {
            if(data.charAt(i) == '{') {
                if(left == 0) {
                    start = i
                }
                left++
            } else if(data.charAt(i) == '}') {
                left--
                if(left == 0) {
                    let json = data.substring(start, i + 1)
                    end = i + 1
                    console.log(`Send: ${json}`)
                    socket.send(json)
                }
            }
        }
        data = data.substring(end)
        last = data.length - end
        start -= end
    })
    process.stderr.on('data', function (respose) {
        console.error(`Error: ${respose.toString()}`)
    })

}
