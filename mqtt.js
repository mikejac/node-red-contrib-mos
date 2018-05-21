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

    const mosRPC    = "rpc";
    const mosWrite  = "Write";
    const mosRead   = "Read";
    const mosUpdate = "Update";
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
        return domain + "/" + bus  + "/" +version + "/" + broadcast + "/" + devicename + "/" + service + "." + mosUpdate;
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
    function MosMqttNode(config) {
        RED.nodes.createNode(this, config);

        this.service        = config.service;
        this.client         = config.client;
        this.mydevicename   = this.id.replace('.', '_');
        this.clientConn     = RED.nodes.getNode(this.client);
        this.rpcCount       = 1;

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

        setTimeout(function() {
            RED.log.debug("MosMqttNode(): initial read");

            var msg = {
                topic:      'read',
                payload:    {}
            }

            node.emit('input', msg);
        }, 100);

        /******************************************************************************************************************
         * subscribe to RPC replies
         *
         */
        RED.log.debug("MosMqttNode(): node.mydevicename          = " + node.mydevicename);
        RED.log.debug("MosMqttNode(): node.clientConn.devicename = " + node.clientConn.devicename);
        RED.log.debug("MosMqttNode(): node.service               = " + node.service);

        var topic = topicRPCSubscribe(node.mydevicename, node.clientConn.devicename, node.service);

        RED.log.debug("MosMqttNode(): topic = " + topic);

        this.clientConn.brokerConn.subscribe(topic, node.clientConn.qos, function(topic, payload, packet) {
            //RED.log.debug("MosMqttNode(subscribe): topic   = " + topic);
            //RED.log.debug("MosMqttNode(subscribe): payload = " + payload);

            try {
                var success = null;
                var err     = null;
                var obj     = JSON.parse(payload.toString());

                if (obj.hasOwnProperty('result')) {
                    success = {
                        topic:    'success',
                        payload:  obj.result
                    }
                } else if (obj.hasOwnProperty('error')) {
                    err = {
                        topic:    'error',
                        payload:  obj.error
                    }
                } else {
                    RED.log.warn("MosMqttNode(): malformed object; " + payload.toString());
                    return;
                }

                node.send(success, err);
            } catch (err) {
                RED.log.error("MosMqttNode(): malformed object; " + err + " -- " + payload.toString());
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

        RED.log.debug("MosMqttNode(): topicUpdate = " + topicUpdate);

        this.clientConn.brokerConn.subscribe(topicUpdate, node.clientConn.qos, function(topic, payload, packet) {
            //RED.log.debug("MosMqttNode(subscribe): topic   = " + topic);
            //RED.log.debug("MosMqttNode(subscribe): payload = " + payload);

            try {
                var msg = {
                    topic: "success",
                    payload: JSON.parse(payload.toString())
                };

                node.send(msg, null);
            } catch (err) {
                RED.log.error("MosMqttNode(): malformed object; " + err + " -- " + payload.toString());
            }
        }, node.id);

        /******************************************************************************************************************
         * respond to inputs from NodeRED
         *
         */
        this.on('input', function (msg) {
            RED.log.debug("MosMqttNode(input)");

            var topic  = '';
            var method = '';

            if (msg.topic.toUpperCase() === 'READ') {
                topic  = topicRPCPublish(node.clientConn.devicename, node.service, mosRead);
                method = node.service + '.' + mosRead;
            } else if (msg.topic.toUpperCase() === 'WRITE') {
                topic  = topicRPCPublish(node.clientConn.devicename, node.service, mosWrite);
                method = node.service + '.' + mosWrite;
            } else {
                RED.log.warn("MosMqttNode(input): user defined topic; " + msg.topic);
                topic  = topicRPCPublish(node.clientConn.devicename, node.service, msg.topic);
                method = node.service + '.' + msg.topic;
            }

            //RED.log.debug("MosMqttNode(input): topic = " + topic);

            //
            // create MOS request object
            //
            var obj = {
                src: node.mydevicename + '_' + node.clientConn.devicename + '_' + node.service,
                id: node.rpcCount++,
                method: method,
                args: msg.payload
            };

            //RED.log.debug("MosMqttNode(input): obj = " + JSON.stringify(obj));

            //
            // create MQTT message
            //
            var newMsg = {
                topic:    topic,
                payload:  JSON.stringify(obj),
                qos:      node.clientConn.qos,
                retain:   node.clientConn.retain
            }
        
            //RED.log.debug("MosMqttNode(input): newMsg = " + JSON.stringify(newMsg))

            node.clientConn.brokerConn.publish(newMsg)
        });

        this.on('close', function(removed, done) {
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

    RED.nodes.registerType("mos-mqtt", MosMqttNode);
}