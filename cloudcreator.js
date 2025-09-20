// Add this at the very top
require('dotenv').config();
const winston = require('winston');
const mysql = require('mysql2/promise');

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'cloudspace.log' })
  ]
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Database connection pool
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cloudspace_database'
};

let pool;

async function initializeDatabase() {
  try {
    pool = mysql.createPool(dbConfig);
    
    // Create table if it doesn't exist
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS cloudspace_instances (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        configuration TEXT NOT NULL,
        access_url VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    await pool.execute(createTableQuery);
    logger.info('Database initialized successfully');
  } catch (error) {
    logger.error('Database initialization failed:', error);
  }
}

// Initialize database when app starts
initializeDatabase();

const express = require('express');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configuration - using environment variables
const config = {
  nutanixHost: process.env.NUTANIX_HOST,
  nutanixUser: process.env.NUTANIX_USER,
  nutanixPassword: process.env.NUTANIX_PASSWORD,
  subnetName: process.env.SUBNET_NAME || "NTNX-IPAM",
  accountName: process.env.ACCOUNT_NAME || "NTNX_LOCAL_AZ",
  directoryServiceUuid: process.env.DIRECTORY_SERVICE_UUID
};

// Plan configurations with prices
const cloudSpacePlans = {
  small: { vcpus: 10, memory_gb: 20, price: 500 },
  medium: { vcpus: 20, memory_gb: 40, price: 900 },
  large: { vcpus: 30, memory_gb: 50, price: 1500 }
};

// Storage options with prices
const storageOptions = {
  "500000000000": { display: "500 GB", price: 0 },
  "1000000000000": { display: "1 TB", price: 0 },
  "2000000000000": { display: "2 TB", price: 0 }
};

// Function to calculate price
function calculatePrice(plan, storageBytes) {
  const planPrice = cloudSpacePlans[plan].price;
  const storagePrice = storageOptions[storageBytes].price;
  return planPrice + storagePrice;
}

// Function to generate random user data
function generateUserData() {
  try {
    // Run the generate-user.js script
    execSync('node generate-user.js', { cwd: __dirname, stdio: 'pipe' });

    // Read the generated user data
    const userDataPath = path.join(__dirname, 'user_data.json');
    if (fs.existsSync(userDataPath)) {
      const userData = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
      return userData;
    } else {
      throw new Error('User data file not found after generation');
    }
  } catch (error) {
    logger.error('Error generating user data:', error);
    throw error;
  }
}

// Function to create project using new Ansible playbook
function createProjectWithUser(vcpusLimit, memoryLimitGb, storageLimitBytes, userData) {
  return new Promise((resolve, reject) => {
    // Use the username as the project name
    const projectName = userData.name;

    // Prepare variables for Ansible
    const ansibleVars = {
      nutanix_host: config.nutanixHost,
      nutanix_username: config.nutanixUser,
      nutanix_password: config.nutanixPassword,
      project_name: projectName,
      project_description: "Cloud space project",
      vcpus_limit: parseInt(vcpusLimit),
      memory_limit: parseInt(memoryLimitGb),
      storage_limit: parseInt(storageLimitBytes),
      subnet_name: config.subnetName,
      account_name: config.accountName,
      directory_service_uuid: config.directoryServiceUuid
    };

    // Execute Ansible playbook
    const ansibleProcess = spawn('ansible-playbook', [
      'create_ad_user_ntnx_project.yaml',
      '-i', 'inventory.ini',
      '--extra-vars', JSON.stringify(ansibleVars)
    ], {
      cwd: __dirname,
      stdio: 'pipe'
    });

    let output = '';
    let errorOutput = '';

    ansibleProcess.stdout.on('data', (data) => {
      output += data.toString();
      logger.info(data.toString());
    });

    ansibleProcess.stderr.on('data', (data) => {
      errorOutput = data.toString();
      logger.error(data.toString());
    });

    ansibleProcess.on('close', (code) => {
      if (code === 0) {
        // Extract project information from output
        const projectInfo = extractProjectInfo(output);

        resolve({
          success: true,
          output,
          userData: {
            username: userData.name,
            password: userData.password,
            upn: userData.upn
          },
          projectUrl: projectInfo.url || "console.demonutanix.africa",
          configuration: {
            vcpus: vcpusLimit,
            memory: memoryLimitGb,
            storage: storageLimitBytes,
            storageDisplay: storageOptions[storageLimitBytes]?.display || `${storageLimitBytes / 1000000000000} TB`
          }
        });
      } else {
        reject({ success: false, output, error: errorOutput });
      }
    });
  });
}

// Helper function to extract project information from Ansible output
function extractProjectInfo(output) {
  // This is a simplified implementation - adjust based on your actual Ansible output
  const info = {
    url: "console.demonutanix.africa" // Default URL
  };

  // Add logic here to parse specific information from the Ansible output
  // For example, if your playbook outputs a specific format, you can regex it

  return info;
}

// Function to store data in MySQL
async function storeInDatabase(username, password, configuration, accessUrl) {
  try {
    const connection = await pool.getConnection();
    const query = `
      INSERT INTO cloudspace_instances 
      (username, password, configuration, access_url) 
      VALUES (?, ?, ?, ?)
    `;
    await connection.execute(query, [username, password, configuration, accessUrl]);
    connection.release();
    logger.info('Data stored in database successfully');
    return true;
  } catch (error) {
    logger.error('Error storing data in database:', error);
    return false;
  }
}

// API endpoint to create project
app.post('/api/project/create', async (req, res) => {
  try {
    const {size, storageBytes } = req.body;

    if (!size || !storageBytes) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: size and storageBytes are required'
      });
    }

    if (!cloudSpacePlans[size]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid size. Must be small, medium, or large.'
      });
    }

    if (!storageOptions[storageBytes]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid storage size.'
      });
    }

    const planConfig = cloudSpacePlans[size];
    const price = calculatePrice(size, storageBytes);

    // Generate user data
    let userData;
    try {
      userData = await generateUserData();
      logger.info('Generated user data:', userData);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate user data',
        details: error.message
      });
    }

    // Create the project with the new user
    const result = await createProjectWithUser(
      planConfig.vcpus,
      planConfig.memory_gb,
      storageBytes,
      userData
    );

    if (result.success) {
      // Store data in MySQL database
      const configuration = `${planConfig.vcpus} vCPUs, ${planConfig.memory_gb}GB RAM, ${result.configuration.storageDisplay} storage`;
      const dbSuccess = await storeInDatabase(
        userData.upn,
        userData.password,
        configuration,
        result.projectUrl
      );

      if (!dbSuccess) {
        logger.warn('Project created but failed to store in database');
      }

      res.json({
        success: true,
        message: 'Project created successfully',
        userData: result.userData,
        projectUrl: result.projectUrl,
        configuration: result.configuration,
        dbSuccess: dbSuccess
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to create project',
        details: result.output
      });
    }
  } catch (error) {
    logger.error('Error creating project:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create project'
    });
  }
});

// API endpoint to get available options
app.get('/api/options', (req, res) => {
  res.json({
    plans: cloudSpacePlans,
    storage: storageOptions
  });
});

// Serve the HTML interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Serve the payment page
app.get('/payment', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'payment.html'));
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully');
  if (pool) {
    await pool.end();
  }
  process.exit(0);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Morocco Cloud Space app listening on port ${PORT}`);
  logger.info('Available plans:');
  Object.keys(cloudSpacePlans).forEach(plan => {
    logger.info(`- ${plan}: ${cloudSpacePlans[plan].vcpus} vCPUs, ${cloudSpacePlans[plan].memory_gb}GB RAM, ${cloudSpacePlans[plan].price} MAD`);
  });
});
