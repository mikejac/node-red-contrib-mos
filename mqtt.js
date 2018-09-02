/**
 * NodeRED Mongoose OS MQTT
 * Copyright (C) 2018 Michael Jacobsen.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 **/


module.exports = function(RED) {
    "use strict";

    const dict      = require("dict");

    const mosRPC     = "rpc";
    const mosWrite   = "Write";
    const mosRead    = "Read";
    const mosUpdate  = "Update";
    const mosSysInfo = "SysInfo";
    const mosInfo    = "Info";

    //
    function topicRPCPublish(devicename, service, typ) {
        return  devicename + "/" +
                mosRPC + "/" +
                service + "." + typ;
    }

    //
    function topicRPCSubscribe(mydevicename, devicename, service) {
        return  mydevicename + "_" + devicename + "_" + service + "/" +
                mosRPC;
    }

    //
    function topicUpdateSubscribe(domain, bus, version, broadcast, devicename, service) {
        return domain + "/" + bus  + "/" + version + "/" + broadcast + "/" + devicename + "/" + service + "." + mosUpdate;
    }

    //
    function topicSysInfoSubscribe(domain, bus, version, broadcast, devicename) {
        return domain + "/" + bus  + "/" + version + "/" + broadcast + "/" + devicename + "/" + mosSysInfo;
    }
    
    //
    function topicInfoSubscribe(domain, bus, version, broadcast, devicename) {
        return domain + "/" + bus  + "/" + version + "/" + broadcast + "/" + devicename + "/" + mosInfo;
    }

    /******************************************************************************************************************
	 * 
	 *
	 */
    function MosMqttClient(config) {
        RED.nodes.createNode(this, config);

        this.nodename   = config.nodename;
        this.domain     = config.domain;
        this.bus        = config.bus;
        this.version    = config.version;
        this.broadcast  = config.broadcast;
        this.devicename = config.devicename;
        this.timeout    = 2000;
        this.qos        = 0;
        this.retain     = false;
        this.broker     = config.broker;
        this.brokerConn = RED.nodes.getNode(this.broker);

        var node = this;

        if (this.brokerConn) {
            node.brokerConn.register(node);
        } else {
            node.log(RED._("mos-mqtt.errors.missing-config"));
            return;
        }

        /******************************************************************************************************************
         * functions called by our 'clients'
         *
         */
        this.register = function(client, service) {
            RED.log.debug("MosMqttClient(): register; service = " + service);
        };

        this.deregister = function(client, service) {
            RED.log.debug("MosMqttClient(): deregister; service = " + service);
        };

        this.connected = function() {
            RED.log.debug("MosMqttClient(): connected");

            return node.brokerConn.connected;
        };

        this.getTimeout = function() {
            return node.timeout;
        };
        
        /******************************************************************************************************************
         * notifications coming from Node-RED
         *
         */
        this.on('close', function(removed, done) {
            node.brokerConn.deregister(node, done);

            if (removed) {
                // this node has been deleted
            } else {
                // this node is being restarted
            }
        });
    }

    RED.nodes.registerType("mos-mqtt-client", MosMqttClient);

    /******************************************************************************************************************
	 * 
	 *
	 */
    function MosMqttRpcNode(config) {
        RED.nodes.createNode(this, config);

        this.service        = config.service;
        this.client         = config.client;
        this.mydevicename   = this.id.replace('.', '_');
        this.clientConn     = RED.nodes.getNode(this.client);
        this.rpcCount       = 1;
        this.timerHandle    = null;
        this.queue          = dict();

        if (!this.clientConn) {
            this.error(RED._("mos-mqtt.errors.missing-config"));
            return;
        } else if (typeof this.clientConn.register !== 'function') {
            this.error(RED._("mos-mqtt.errors.missing-broker"));
            return;            
        }
        
        this.clientConn.register(this, this.service);

        var node = this;

        if (node.clientConn.connected) {
            node.status({fill:"green", shape:"dot", text:"node-red:common.status.connected"});
        }

        if (config.initialread) {
            setTimeout(function() {
                RED.log.debug("MosMqttRpcNode(): initial read");

                var msg = {
                    topic:      'read',
                    payload:    {}
                }

                node.emit('input', msg);
            }, 100);
        }

        /******************************************************************************************************************
         * functions
         *
         */
        this.disableTimer = function() {
            if (node.timerHandle) {    
                clearInterval(node.timerHandle);
                node.timerHandle = null;    
            }
        }
          
        this.enableTimer = function() {
            if (node.timerHandle == null) {
                node.timerHandle = setInterval(node.timerProc.bind(this), 1000);
            }
        }
          
        this.timerProc = function() {
            RED.log.debug("MosMqttRpcNode(timerproc): queue size = " + node.queue.size);
            
            if (node.queue.size == 0) {
                node.disableTimer();
                return;
            };
          
            node.queue.forEach(function (value, k) {
                if (node.clientConn.connected() == false) {
                    // the transport is inactive. cancel pending requests
                    RED.log.debug("MosMqttRpcNode(timerproc): not connected; " + JSON.stringify(value));

                    var err = {
                        topic:    'error',
                        payload:  {
                            code:    503,
                            message: 'the transport is not active'
                        }
                    };
                    
                    node.send([null, err]);
                    node.queue.delete(k);
                } else if ((new Date()).getTime() - value.datetime >= node.clientConn.getTimeout()) {
                    // discard requests that had timed out
                    RED.log.debug("MosMqttRpcNode(timerproc): timeout; " + JSON.stringify(value));

                    var err = {
                        topic:    'error',
                        payload:  {
                            code:    408,
                            message: 'request timed out'
                        }
                    };
                    
                    node.send([null, err]);
                    node.queue.delete(k);
                }
            }); 
             
            if (node.queue.size == 0) {
                node.disableTimer();
            }
        }
          
        /******************************************************************************************************************
         * subscribe to RPC replies
         *
         */
        RED.log.debug("MosMqttRpcNode(): node.mydevicename          = " + node.mydevicename);
        RED.log.debug("MosMqttRpcNode(): node.clientConn.devicename = " + node.clientConn.devicename);
        RED.log.debug("MosMqttRpcNode(): node.service               = " + node.service);

        var topic = topicRPCSubscribe(node.mydevicename, node.clientConn.devicename, node.service);

        RED.log.debug("MosMqttNode(): topic = " + topic);

        this.clientConn.brokerConn.subscribe(topic, node.clientConn.qos, function(topic, payload, packet) {
            //RED.log.debug("MosMqttRpcNode(subscribe): topic   = " + topic);
            //RED.log.debug("MosMqttRpcNode(subscribe): payload = " + payload);

            try {
                var success = null;
                var err     = null;
                var obj     = JSON.parse(payload.toString());
                
                if (obj.hasOwnProperty('id')) {
                    if (!node.queue.has(obj.id.toString())) {
                        RED.log.warn("MosMqttRpcNode(): invalid response (id)");

                        err = {
                            topic:    'warning',
                            payload:  {
                                code:    412,
                                message: 'unknown id'
                            }
                        };
                    } else {
                        RED.log.debug("MosMqttRpcNode(): 'id' found");

                        node.queue.delete(obj.id.toString());

                        if (node.queue.size == 0) {
                            node.disableTimer();
                        }
            
                        if (obj.hasOwnProperty('result')) {
                            success = {
                                topic:    'success',
                                payload:  obj.result
                            }
                        } else if (obj.hasOwnProperty('error')) {
                            err = {
                                topic:    'error',
                                payload:  {
                                    code:    400,
                                    message: obj.error
                                }
                            }
                        } else {
                            RED.log.warn("MosMqttRpcNode(): malformed object; " + payload.toString());
                            return;
                        }
                    }
                } else {
                    err = {
                        topic:    'error',
                        payload:  {
                            code:    406,
                            message: 'id missing'
                        }
                    };
                }

                node.send([success, err]);
            } catch (err) {
                RED.log.error("MosMqttRpcNode(): malformed object; " + err + " -- " + payload.toString());
            }
        }, node.id);

        /******************************************************************************************************************
         * subscribe to RPC updates
         *
         */
        var topicUpdate = topicUpdateSubscribe( node.clientConn.domain, 
                                                node.clientConn.bus, 
                                                node.clientConn.version, 
                                                node.clientConn.broadcast, 
                                                node.clientConn.devicename, 
                                                node.service);

        RED.log.debug("MosMqttRpcNode(): topicUpdate = " + topicUpdate);

        this.clientConn.brokerConn.subscribe(topicUpdate, node.clientConn.qos, function(topic, payload, packet) {
            //RED.log.debug("MosMqttRpcNode(subscribe): topic   = " + topic);
            //RED.log.debug("MosMqttRpcNode(subscribe): payload = " + payload);

            try {
                var msg = {
                    topic: "success",
                    payload: JSON.parse(payload.toString())
                };

                node.send([msg, null]);
            } catch (err) {
                RED.log.error("MosMqttRpcNode(): malformed object; " + err + " -- " + payload.toString());
            }
        }, node.id);

        /******************************************************************************************************************
         * respond to inputs from NodeRED
         *
         */
        this.on('input', function (msg) {
            RED.log.debug("MosMqttRpcNode(input)");

            var topic  = '';
            var method = '';

            if (msg.topic.toUpperCase() === 'READ') {
                topic  = topicRPCPublish(node.clientConn.devicename, node.service, mosRead);
                method = node.service + '.' + mosRead;
            } else if (msg.topic.toUpperCase() === 'WRITE') {
                topic  = topicRPCPublish(node.clientConn.devicename, node.service, mosWrite);
                method = node.service + '.' + mosWrite;
            } else {
                RED.log.debug("MosMqttNode(input): user defined topic; " + msg.topic);
                topic  = topicRPCPublish(node.clientConn.devicename, node.service, msg.topic);
                method = node.service + '.' + msg.topic;
            }

            //RED.log.debug("MosMqttRpcNode(input): topic = " + topic);

            //
            // create MOS request object
            //
            var obj = {
                src: node.mydevicename + '_' + node.clientConn.devicename + '_' + node.service,
                id: node.rpcCount++,
                method: method,
                args: msg.payload
            };

            node.queue.set(obj.id.toString(), {
                datetime: (new Date()).getTime(),
                payload: obj
            });

            //RED.log.debug("MosMqttRpcNode(input): obj = " + JSON.stringify(obj));

            //
            // create MQTT message
            //
            var newMsg = {
                topic:    topic,
                payload:  JSON.stringify(obj),
                qos:      node.clientConn.qos,
                retain:   node.clientConn.retain
            }
        
            //RED.log.debug("MosMqttRpcNode(input): newMsg = " + JSON.stringify(newMsg))

            node.clientConn.brokerConn.publish(newMsg);

            node.enableTimer();
        });

        this.on('close', function(removed, done) {
            node.queue.clear();

            node.clientConn.deregister(node, node.service);

            if (removed) {
                // this node has been deleted
            } else {
                // this node is being restarted
            }

            if (typeof done === 'function') {
                done();
            }
        });
    }

    RED.nodes.registerType("mos-mqtt-rpc", MosMqttRpcNode);

    /******************************************************************************************************************
	 * 
	 *
	 */
    function MosMqttSystemNode(config) {
        RED.nodes.createNode(this, config);

        this.wdt            = config.wdt;
        this.wdtStatus      = -1;
        this.client         = config.client;
        this.mydevicename   = this.id.replace('.', '_');
        this.clientConn     = RED.nodes.getNode(this.client);
        this.timerHandle    = null;
        this.sendStatus     = config.status;
        this.sendInfo       = config.info;
        this.sendSysInfo    = config.sysinfo;
        this.sendSettings   = config.setting;

        if (!this.clientConn) {
            this.error(RED._("mos-mqtt.errors.missing-config"));
            return;
        } else if (typeof this.clientConn.register !== 'function') {
            this.error(RED._("mos-mqtt.errors.missing-broker"));
            return;            
        }
        
        this.clientConn.register(this, "system");

        var node = this;

        if (node.clientConn.connected) {
            node.status({fill:"yellow", shape:"dot", text:"node-red:common.status.connected"});
        }

        /******************************************************************************************************************
         * functions
         *
         */
        this.disableTimer = function() {
            if (node.timerHandle) {    
                clearTimeout(node.timerHandle);
                node.timerHandle = null;    
            }
        }
          
        this.enableTimer = function() {
            if (node.timerHandle) {
                RED.log.debug("MosMqttSystemNode(enableTimer): clear timer");
                clearTimeout(node.timerHandle);
                node.timerHandle = null;
            }

            if (node.wdt > 0) {
                RED.log.debug("MosMqttSystemNode(enableTimer): node.wdt > 0");
                node.timerHandle = setTimeout(node.timerProc.bind(this), (node.wdt + 1) * 1000);
            } else {
                RED.log.debug("MosMqttSystemNode(enableTimer): node.wdt <= 0");
            }
        }
          
        this.resetTimer = function() {
            if (node.wdt <= 0) {
                return;
            }

            node.enableTimer();
            RED.log.debug("MosMqttSystemNode(resetTimer): node.wdtStatus = " + node.wdtStatus)

            if (node.wdtStatus != 1) {
                node.wdtStatus = 1

                var status = {
                    topic: "online",
                    payload: true
                };

                var log = {
                    topic: "log",
                    payload: {
                        device: node.clientConn.devicename,
                        type: "status",
                        msg: "Online"
                    }
                };

                if (!node.sendStatus) {
                    log = null;
                }

                node.send([null, null, status, log]);
                node.status({fill:"green", shape:"dot", text:"device online"});
            }
        }

        this.timerProc = function() {
            RED.log.debug("MosMqttSystemNode(timerproc): run; wdt = " + node.wdt);

            if (node.wdtStatus != 0) {
                node.wdtStatus = 0
    
                RED.log.debug("MosMqttSystemNode(timerproc): timeout");

                var status = {
                    topic: "online",
                    payload: false
                };

                var log = {
                    topic: "log",
                    payload: {
                        device: node.clientConn.devicename,
                        type: "status",
                        msg: "Offline"
                    }
                };

                if (!node.sendStatus) {
                    log = null;
                }

                node.send([null, null, status, log]);
                node.status({fill:"red", shape:"dot", text:"device offline"});
            }
        }

        node.enableTimer();

        /******************************************************************************************************************
         * subscribe to SysInfo updates
         *
         */
        var topicSysInfo = topicSysInfoSubscribe(   node.clientConn.domain, 
                                                    node.clientConn.bus, 
                                                    node.clientConn.version, 
                                                    node.clientConn.broadcast, 
                                                    node.clientConn.devicename);

        RED.log.debug("MosMqttSystemNode(): topicSysInfo = " + topicSysInfo);

        this.clientConn.brokerConn.subscribe(topicSysInfo, node.clientConn.qos, function(topic, payload, packet) {
            RED.log.debug("MosMqttSystemNode(SysInfo): topic   = " + topic);
            RED.log.debug("MosMqttSystemNode(SysInfo): payload = " + payload);

            node.resetTimer();

            try {
                var msg = {
                    topic: "sysinfo",
                    payload: JSON.parse(payload.toString())
                };

                var log = {
                    topic: "log",
                    payload: {
                        device: node.clientConn.devicename,
                        type: "sysinfo",
                        msg: msg.payload
                    }
                };

                if (!node.sendSysInfo) {
                    log = null;
                }

                node.send([msg, null, null, log]);
            } catch (err) {
                RED.log.error("MosMqttSystemNode(SysInfo): malformed object; " + err + " -- " + payload.toString());
            }
        }, node.id);

        /******************************************************************************************************************
         * subscribe to Info updates
         *
         */
        var topicInfo = topicInfoSubscribe( node.clientConn.domain, 
                                            node.clientConn.bus, 
                                            node.clientConn.version, 
                                            node.clientConn.broadcast, 
                                            node.clientConn.devicename);

        RED.log.debug("MosMqttSystemNode(): topicInfo = " + topicInfo);

        this.clientConn.brokerConn.subscribe(topicInfo, node.clientConn.qos, function(topic, payload, packet) {
            RED.log.debug("MosMqttSystemNode(Info): topic   = " + topic);
            RED.log.debug("MosMqttSystemNode(Info): payload = " + payload);

            node.resetTimer();

            try {
                var msg = {
                    topic: "info",
                    payload: JSON.parse(payload.toString())
                };

                var log = {
                    topic: "log",
                    payload: {
                        device: node.clientConn.devicename,
                        type: "info",
                        msg: msg.payload.data
                    }
                };

                if (!node.sendInfo) {
                    log = null;
                }

                node.send([msg, null, null, log]);
            } catch (err) {
                RED.log.error("MosMqttSystemNode(Info): malformed object; " + err + " -- " + payload.toString());
            }
        }, node.id);

        /******************************************************************************************************************
         * respond to inputs from NodeRED
         *
         */
        this.on('input', function (msg) {
            RED.log.debug("MosMqttSystemNode(input)");

            if (msg.topic.toUpperCase() === 'GET') {
                var status = {
                    topic: "online",
                    payload: false
                };

                if (node.wdtStatus == 1) {
                    status.payload = true;
                }
    
                node.send([null, null, status, null]);
            } else if (msg.topic.toUpperCase() === 'SETWATCHDOG') {
                var val = 0;

                if (typeof msg.payload === 'string') {
                    val = parseInt(msg.payload);

                    if (isNaN(val)) {
                        RED.log.error("MosMqttSystemNode(input): not-a-number");
                        return;
                    }
                } else if (typeof msg.payload === 'number') {
                    val = msg.payload;
                } else {
                    RED.log.error("MosMqttSystemNode(input): invalid payload");
                    return;
                }

                node.wdt = val;

                var log = {
                    topic: "log",
                    payload: {
                        device: node.clientConn.devicename,
                        type: "setting",
                        msg: ""
                    }
                };

                if (node.wdt > 0) {
                    RED.log.debug("MosMqttSystemNode(input): enable timer");
                    node.enableTimer();

                    log.payload.msg = "Watchdog timer enabled. Timeout = " + val + " seconds";
                } else {
                    RED.log.debug("MosMqttSystemNode(input): disable timer");
                    node.disableTimer();

                    log.payload.msg = "Watchdog timer disabled";
                }

                if (node.sendSettings) {
                    node.send([null, null, null, log]);
                }
            }
        });

        this.on('close', function(removed, done) {
            node.disableTimer();

            node.clientConn.deregister(node, "system");

            if (removed) {
                // this node has been deleted
            } else {
                // this node is being restarted
            }

            if (typeof done === 'function') {
                done();
            }
        });
    }

    RED.nodes.registerType("mos-mqtt-system", MosMqttSystemNode);
}

