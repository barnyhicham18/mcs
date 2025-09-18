// Add this at the very top
require('dotenv').config();

const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const axios = require('axios');
const https = require('https');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Database connection pool
const dbPool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Initialize database table for cloud spaces
async function initializeDatabase() {
  try {
    const connection = await dbPool.getConnection();
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS cloud_spaces (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_name VARCHAR(255) NOT NULL,
        description TEXT,
        vcpus_limit INT NOT NULL,
        memory_limit_gb INT NOT NULL,
        storage_limit_bytes BIGINT NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'created',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    connection.release();
    console.log('Database table initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

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
  "1000000000000": { display: "1 TB", price: 100 },
  "2000000000000": { display: "2 TB", price: 190 },
  "3000000000000": { display: "3 TB", price: 250 }
};

// Function to calculate price
function calculatePrice(plan, storageBytes) {
  const planPrice = cloudSpacePlans[plan].price;
  const storagePrice = storageOptions[storageBytes].price;
  return planPrice + storagePrice;
}

// Function to create project using Ansible
function createProject(projectName, description, vcpusLimit, memoryLimitGb, storageLimitBytes) {
  return new Promise((resolve, reject) => {
    // Create temporary files
    const tempVarsFile = path.join(__dirname, 'temp_project_vars.yaml');

    // Prepare variables for Ansible
    const ansibleVars = {
      nutanix_host: config.nutanixHost,
      nutanix_username: config.nutanixUser,
      nutanix_password: config.nutanixPassword,
      project_name: projectName,
      project_description: description,
      vcpus_limit: vcpusLimit,
      memory_limit: memoryLimitGb * 1000000000, // Convert GB to bytes
      storage_limit: storageLimitBytes,
      subnet_name: config.subnetName,
      account_name: config.accountName,
      directory_service_uuid: config.directoryServiceUuid
    };

    // Write temporary files
    fs.writeFileSync(tempVarsFile, yaml.dump(ansibleVars));

    // Execute Ansible playbook
    const ansibleProcess = spawn('ansible-playbook', [
      'project_create.yaml',
      '--extra-vars',
      `@${tempVarsFile}`
    ], {
      cwd: __dirname,
      stdio: 'pipe'
    });

    let output = '';
    let errorOutput = '';

    ansibleProcess.stdout.on('data', (data) => {
      output += data.toString();
      console.log(data.toString());
    });

    ansibleProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error(data.toString());
    });

    ansibleProcess.on('close', (code) => {
      // Remove temporary files
      try {
        fs.unlinkSync(tempVarsFile);
      } catch (err) {
        console.error('Error cleaning up temporary files:', err);
      }

      if (code === 0) {
        resolve({ success: true, output });
      } else {
        reject({ success: false, output, error: errorOutput });
      }
    });
  });
}

// Store project details in database
async function storeProjectInDatabase(projectData) {
  try {
    const connection = await dbPool.getConnection();
    const [result] = await connection.execute(
      `INSERT INTO cloud_spaces (project_name, description, vcpus_limit, memory_limit_gb, storage_limit_bytes, price)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        projectData.projectName,
        projectData.description,
        projectData.vcpusLimit,
        projectData.memoryLimitGb,
        projectData.storageLimitBytes,
        projectData.price
      ]
    );
    connection.release();
    console.log('Project details stored in database with ID:', result.insertId);
    return result.insertId;
  } catch (error) {
    console.error('Error storing project in database:', error);
    throw error;
  }
}

// API endpoint to create project
app.post('/api/project/create', async (req, res) => {
  try {
    const { projectName, description, size, storageBytes } = req.body;

    if (!projectName || !size || !storageBytes) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: projectName, size, and storageBytes are required'
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

    // Create the project
    const result = await createProject(
      projectName,
      description,
      planConfig.vcpus,
      planConfig.memory_gb,
      storageBytes
    );

    if (result.success) {
      // Prepare project data for database
      const projectData = {
        projectName,
        description,
        vcpusLimit: planConfig.vcpus,
        memoryLimitGb: planConfig.memory_gb,
        storageLimitBytes: storageBytes,
        price
      };

      // Store project details in database
      await storeProjectInDatabase(projectData);

      res.json({ success: true, message: 'Project created successfully' });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to create project',
        details: result.output
      });
    }
  } catch (error) {
    console.error('Error creating project:', error);
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

// API endpoint to get all projects from database
app.get('/api/projects', async (req, res) => {
  try {
    const connection = await dbPool.getConnection();
    const [rows] = await connection.execute('SELECT * FROM cloud_spaces ORDER BY created_at DESC');
    connection.release();
    res.json({ success: true, projects: rows });
  } catch (error) {
    console.error('Error fetching projects from database:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch projects from database'
    });
  }
});

// Serve the HTML interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Serve the payment page
app.get('/payment', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'payment.html'));
});

// Initialize the server and database
async function initializeServer() {
  try {
    // Initialize database table
    await initializeDatabase();

    // Start the server
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Cloud Space Provider app listening on port ${PORT}`);
      console.log('Available plans:');
      Object.keys(cloudSpacePlans).forEach(plan => {
        console.log(`- ${plan}: ${cloudSpacePlans[plan].vcpus} vCPUs, ${cloudSpacePlans[plan].memory_gb}GB RAM, ${cloudSpacePlans[plan].price} MAD`);
      });
      console.log('Available storage options:');
      Object.keys(storageOptions).forEach(bytes => {
        console.log(`- ${bytes} bytes: ${storageOptions[bytes].display}, ${storageOptions[bytes].price} MAD`);
      });
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

// Start the server initialization
initializeServer();
