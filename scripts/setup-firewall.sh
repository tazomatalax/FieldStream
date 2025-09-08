#!/bin/bash
# Enhanced firewall configuration for DMZ micro-segmentation
# !! WARNING: Run this with care. It may disconnect you if run on a remote machine without proper SSH rules. !!

echo "Setting up DMZ firewall rules..."

# Define network interfaces and subnets (adjust if necessary)
DMZ_WEB_SUBNET="172.20.1.0/24"
DMZ_MQTT_SUBNET="172.20.2.0/24"
DMZ_INTERNAL_BRIDGE_SUBNET="172.20.3.0/24"
EXTERNAL_INTERFACE="eth0"

# Flush the DOCKER-USER chain to ensure a clean slate
iptables -F DOCKER-USER

# 1. Default allow established connections
iptables -I DOCKER-USER -m state --state RELATED,ESTABLISHED -j ACCEPT

# 2. External -> DMZ-Web: Allow HTTP/HTTPS
iptables -I DOCKER-USER -i ${EXTERNAL_INTERFACE} -d ${DMZ_WEB_SUBNET} -p tcp --dport 443 -j ACCEPT
iptables -I DOCKER-USER -i ${EXTERNAL_INTERFACE} -d ${DMZ_WEB_SUBNET} -p tcp --dport 80 -j ACCEPT

# 3. DMZ-Web -> DMZ-MQTT: Allow MQTTS from WebSocket Server to MQTT Broker
iptables -I DOCKER-USER -s ${DMZ_WEB_SUBNET} -d ${DMZ_MQTT_SUBNET} -p tcp --dport 8883 -j ACCEPT

# 4. DMZ-MQTT -> Internal Bridge: Allow MQTT Broker to talk to the internal network via the bridge
iptables -I DOCKER-USER -s ${DMZ_MQTT_SUBNET} -d ${DMZ_INTERNAL_BRIDGE_SUBNET} -p tcp --dport 8883 -j ACCEPT

# 5. Default DENY for all other traffic within or to the DMZ subnets
# This is the most critical rule for micro-segmentation
iptables -A DOCKER-USER -s ${DMZ_WEB_SUBNET} -j DROP
iptables -A DOCKER-USER -s ${DMZ_MQTT_SUBNET} -j DROP
iptables -A DOCKER-USER -d ${DMZ_WEB_SUBNET} -j DROP
iptables -A DOCKER-USER -d ${DMZ_MQTT_SUBNET} -j DROP

# 6. Log dropped packets for monitoring
iptables -A DOCKER-USER -j LOG --log-prefix "DMZ-DROP: " --log-level 4

echo "Firewall rules applied to DOCKER-USER chain."