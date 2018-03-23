/**
 * NodeRED Hue Bridge
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

    const mosRPC = "rpc";

    //
    function topicRPCPublish(nodename, devicename) {
        return  nodename + "/" +
                mosRPC + "/" +
                devicename + "." + msgbusWrite;
    }

    //
    function topicRPCSubscribe(mynodename, nodename, dataId) {
        return  mynodename + "_" + nodename + "_" + dataId + "/" +
                mosRPC;
    }

    /******************************************************************************************************************
	 * 
	 *
	 */
    function MosMqttClient(config) {
        RED.nodes.createNode(this, config);

        this.nodename   = config.nodename;
        this.domain     = config.domain;
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

        this.service    = config.service;
        this.client     = config.client;
        this.clientConn = RED.nodes.getNode(this.client);

        if (!this.clientConn) {
            this.error(RED._("mos-mqtt.errors.missing-config"));
            return;
        } else if (typeof this.clientConn.register !== 'function') {
            this.error(RED._("mos-mqtt.errors.missing-bridge"));
            return;            
        }
        
        this.clientConn.register(this, this.service);

        var node = this;

        if (node.clientConn.connected) {
            node.status({fill:"green", shape:"dot", text:"node-red:common.status.connected"});
        }

        /******************************************************************************************************************
         * subscribe to RPC replies
         *
         */
        var topic = topicRPCSubscribe(node.id, node.clientConn.devicename, node.service);

        RED.log.debug("MosMqttNode(): topic = " + topic);

        this.brokerConn.subscribe(topic, node.clientConn.qos, function(topic, payload, packet) {
            try {
                /*var obj = JSON.parse(payload)

                for (var id in node.users) {
                    if (node.users.hasOwnProperty(id)) {
                        var t = node.nodename + "_"  + node.users[id].nodename + "_" + node.users[id].dataId
                        //RED.log.debug("HomeKitMQTTClientNode(): register, subscribe; t = " + t)
                        
                        if (obj.dst == t) {
                            //RED.log.debug("HomeKitMQTTClientNode(): register, subscribe; found node")
                            node.users[id].rpcReply(obj.result)
                        }
                    }
                }*/
            } catch (err) {
                RED.log.error("MosMqttNode(): malformed object; " + payload.toString())
            }
        }, node.id);

        /******************************************************************************************************************
         * respond to inputs from NodeRED
         *
         */
        this.on('input', function (msg) {
            RED.log.debug("MosMqttNode(input)");

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