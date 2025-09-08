# FieldStream Researcher Guide

**Get your field data flowing to the corporate network in 15 minutes**

A step-by-step guide for researchers using FieldStream to securely stream sensor data, images, and events from remote locations back to the corporate network.

## 📋 What You'll Need

### Hardware Requirements
- Field device with Docker support (Raspberry Pi, industrial PC, etc.)
- Internet connection (WiFi, cellular, or ethernet)
- SD card or storage (minimum 8GB)

### From IT Department
- **FieldStream deployment bundle** (provided as a zip/tar file)
- **Domain name** of the data collection server (e.g., `data.yourcompany.com`)
- **InfluxDB connection details** (if you want to verify data arrival)

## 🚀 Quick Start (15 minutes)

### Step 1: Prepare Your Field Device

**Extract the FieldStream bundle:**
```bash
# Extract the provided FieldStream bundle
tar -xzf fieldstream-device-bundle.tar.gz
cd fieldstream-*-device/

# Scripts are already executable
ls -la *.sh
```

### Step 2: Configure Your Device

**Edit the device configuration:**
```bash
# Copy and edit environment file
cp .env.example .env
nano .env

# Set these required values:
DEVICE_ID=your-unique-device-name       # e.g., "hydrogel-site-alpha-01"
DOMAIN_NAME=data.yourcompany.com        # Provided by IT
```

**Example configuration:**
```env
DEVICE_ID=hydrogel-greenhouse-03
DOMAIN_NAME=data.mycompany.com
DEVICE_LOCATION=greenhouse-complex-north
RESEARCHER_NAME=jane.smith
PROJECT_ID=hydrogel-2024-study
```

### Step 3: Test Connectivity

**Run the connection test:**
```bash
./test-connection.sh
```

**Expected output:**
```
✓ Internet connectivity: OK
✓ Server reachable: data.mycompany.com
✓ Certificates valid: expires 2025-12-31
✓ Docker running: version 24.0.7
✓ Ready to deploy
```

### Step 4: Deploy FieldStream

**Start data streaming:**
```bash
./deploy.sh
```

**Monitor connection status:**
```bash
# View live connection status
./status.sh

# View data transmission logs
docker-compose logs -f --tail=50
```

### Step 5: Verify Data Flow

**Check data is reaching the server:**
```bash
# Test data transmission
./send-test-data.sh

# Expected: "✓ Test data sent and acknowledged"
```

## 📊 Monitoring Your Deployment

### Real-time Status Dashboard
```bash
# View comprehensive status
./status.sh

# Output shows:
# Connection Status: ✓ Connected to data.mycompany.com
# Data Sent: 1,247 messages (last: 2 seconds ago)
# Errors: 0
# Device ID: hydrogel-greenhouse-03
# Uptime: 2 days, 3 hours
```

### Data Verification
```bash
# Check recent data transmission
./verify-data.sh

# Shows last 10 messages sent with timestamps
```

### Troubleshooting Tools
```bash
# Connection diagnostics
./diagnose.sh

# Certificate verification
./check-certificates.sh

# Network connectivity test
./test-network.sh
```

## 🔧 Common Configurations

### High-Frequency Sensors (every second)
```env
DATA_SEND_INTERVAL=1000
BATCH_SIZE=10
```

### Battery-Powered Devices (every 5 minutes)
```env
DATA_SEND_INTERVAL=300000
POWER_SAVE_MODE=true
```

### Image/File Data
```env
ENABLE_FILE_UPLOAD=true
MAX_FILE_SIZE_MB=10
IMAGE_QUALITY=medium
```

### Offline Resilience
```env
OFFLINE_BUFFER_HOURS=24
AUTO_RETRY=true
MAX_RETRY_ATTEMPTS=10
```

## 📱 Simple Data Sending Examples

### Send Sensor Data
```javascript
// Your application sends data like this:
const data = {
    deviceId: process.env.DEVICE_ID,
    dataType: "timeseries",
    payload: {
        temperature: 23.5,
        humidity: 65.2,
        soil_moisture: 45.7,
        timestamp: new Date().toISOString()
    }
};

// Client automatically handles connection, security, retry logic
sendData(data);
```

### Send Images
```javascript
// Send field photos with metadata
const imageData = {
    deviceId: process.env.DEVICE_ID,
    dataType: "file",
    payload: {
        filename: "plot-A-morning.jpg",
        contentType: "image/jpeg",
        data: base64ImageData,
        metadata: {
            location: "plot-A-northeast",
            timestamp: new Date().toISOString(),
            researcher: "jane.smith"
        }
    }
};

sendData(imageData);
```

### Send Events/Alerts
```javascript
// Send important events
const alert = {
    deviceId: process.env.DEVICE_ID,
    dataType: "event",
    payload: {
        eventType: "threshold_exceeded",
        severity: "high",
        message: "Soil moisture below 20% - irrigation needed",
        value: 18.5,
        threshold: 20.0,
        timestamp: new Date().toISOString()
    }
};

sendData(alert);
```

## 🛠️ Maintenance

### Update Field Client
```bash
# Get latest version
./update.sh

# Will safely update while preserving your configuration
```

### Backup Configuration
```bash
# Create configuration backup
./backup-config.sh

# Restore from backup
./restore-config.sh backup-2024-01-15.tar.gz
```

### Certificate Renewal
```bash
# Certificates auto-renew, but you can check status
./check-certificates.sh

# Manual renewal (if needed)
./renew-certificates.sh
```

## ❓ Troubleshooting

### "Connection Refused"
1. Verify internet connectivity: `ping google.com`
2. Check domain name in `.env` file
3. Contact IT to verify server is running
4. Run: `./diagnose.sh`

### "Certificate Error"
1. Check certificate files exist: `ls certs/`
2. Verify not expired: `./check-certificates.sh`
3. Contact IT for new certificate bundle

### "Data Not Appearing"
1. Run test: `./send-test-data.sh`
2. Check device ID is unique: `grep DEVICE_ID .env`
3. Verify InfluxDB access with IT department

### "High Data Usage"
1. Check sending frequency: `grep INTERVAL .env`
2. Reduce image quality: Set `IMAGE_QUALITY=low`
3. Enable compression: Set `ENABLE_COMPRESSION=true`

## 📞 Getting Help

### Self-Service Diagnostics
```bash
# Comprehensive health check
./health-check.sh > health-report.txt

# Send health-report.txt to IT support
```

### Log Collection
```bash
# Collect all relevant logs
./collect-logs.sh

# Creates: device-logs-2024-01-15.tar.gz
# Send this file when reporting issues
```

### Configuration Validator
```bash
# Check configuration is valid
./validate-config.sh

# Outputs specific issues and suggestions
```

## 🎯 Best Practices

### Device Naming
- Use descriptive, unique names: `hydrogel-site-a-sensor-01`
- Include location and purpose: `greenhouse-temp-humidity-main`
- Avoid spaces and special characters

### Data Organization
- Set consistent `PROJECT_ID` for related devices
- Include `RESEARCHER_NAME` for data attribution
- Use meaningful `DEVICE_LOCATION` descriptions

### Network Considerations
- Test connectivity before deployment
- Consider cellular data costs for remote sites
- Enable compression for limited bandwidth

### Security
- Never share certificate files
- Keep device physically secure
- Report lost/stolen devices immediately

## 📈 Advanced Features

### Custom Data Processing
- Add pre-processing scripts in `scripts/custom/`
- Filter or aggregate data before transmission
- Local data logging for backup

### Integration with External Sensors
- Configure sensor drivers in `sensors/`
- Supports Modbus, I2C, Serial protocols
- Auto-discovery for USB sensors

### Scheduling and Automation
- Set collection schedules: `crontab -e`
- Automatic startup after power loss
- Coordinated multi-device experiments