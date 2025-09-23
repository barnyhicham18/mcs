// Add this at the very top
require('dotenv').config();
const winston = require('winston');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { spawn, execSync } = require('child_process');
const yaml = require('js-yaml');
const axios = require('axios');
const https = require('https');

// -----------------------------
// Logger setup
// -----------------------------
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

// -----------------------------
// Database setup
// -----------------------------
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

// -----------------------------
// Express app setup
// -----------------------------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// -----------------------------
// Configuration
// -----------------------------
const config = {
  nutanixHost: process.env.NUTANIX_HOST,
  nutanixUser: process.env.NUTANIX_USER,
  nutanixPassword: process.env.NUTANIX_PASSWORD,
  subnetName: process.env.SUBNET_NAME || "NTNX-IPAM",
  clusterName: process.env.CLUSTER_NAME,
  accountName: process.env.ACCOUNT_NAME || "NTNX_LOCAL_AZ",
  directoryServiceUuid: process.env.DIRECTORY_SERVICE_UUID
};

// -----------------------------
// Plans and storage options
// -----------------------------
const cloudSpacePlans = {
  small: { vcpus: 10, memory_gb: 20, price: 500 },
  medium: { vcpus: 20, memory_gb: 40, price: 900 },
  large: { vcpus: 30, memory_gb: 50, price: 1500 }
};

const storageOptions = {
  "500000000000": { display: "500 GB", price: 0 },
  "1000000000000": { display: "1 TB", price: 0 },
  "2000000000000": { display: "2 TB", price: 0 }
};

// -----------------------------
// Helper functions
// -----------------------------
function calculatePrice(plan, storageBytes) {
  const planPrice = cloudSpacePlans[plan].price;
  const storagePrice = storageOptions[storageBytes].price;
  return planPrice + storagePrice;
}

function generateUserData() {
  try {
    execSync('node generate-user.js', { cwd: __dirname, stdio: 'pipe' });

    const userDataPath = path.join(__dirname, 'user_data.json');
    if (fs.existsSync(userDataPath)) {
      return JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
    } else {
      throw new Error('User data file not found after generation');
    }
  } catch (error) {
    logger.error('Error generating user data:', error);
    throw error;
  }
}

function createProjectWithUser(vcpusLimit, memoryLimitGb, storageLimitBytes, userData) {
  return new Promise((resolve, reject) => {
    const projectName = userData.name;

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
      cluster_name: config.clusterName,
      account_name: config.accountName,
      directory_service_uuid: config.directoryServiceUuid
    };

    const ansibleProcess = spawn('ansible-playbook', [
      'create_ad_user_ntnx_project.yaml',
      '-i', 'inventory.ini',
      '--extra-vars', JSON.stringify(ansibleVars)
    ], { cwd: __dirname, stdio: 'pipe' });

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
        const projectInfo = extractProjectInfo(output);

        resolve({
          success: true,
          output,
          userData: { username: userData.name, password: userData.password, upn: userData.upn },
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

function extractProjectInfo(output) {
  return { url: "console.demonutanix.africa" };
}

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

// -----------------------------
// Authorization Policy (ACP)
// -----------------------------
async function createAccessControlPolicy() {
  try {
    const projectData = JSON.parse(fs.readFileSync('project_data.json', 'utf8'));
    logger.info('Loaded project_data.json:', projectData);

    const payload = {
      metadata: { kind: "access_control_policy", spec_version: 1 },
      spec: {
        name: `${projectData.project_name}_auth_policy`,
        description: "ACP for all entities including VPC, overlay_subnet, project, category",
        resources: {
          role_reference: { kind: "role", uuid: "198c5620-e4b3-4866-6275-bcf7070837b7" },
          user_reference_list: [{ kind: "user", uuid: projectData.user_uuid }],
          filter_list: {
            context_list: [
              {
                entity_filter_expression_list: [
                  { left_hand_side: { entity_type: "vm" }, operator: "IN", right_hand_side: { uuid_list: [projectData.project_uuid] } }
                ],
                scope_filter_expression_list: []
              },
              {
                entity_filter_expression_list: [
                  { left_hand_side: { entity_type: "project" }, operator: "IN", right_hand_side: { uuid_list: [projectData.project_uuid] } }
                ],
                scope_filter_expression_list: []
              },
              {
                entity_filter_expression_list: [
                  { left_hand_side: { entity_type: "subnet" }, operator: "IN", right_hand_side: { uuid_list: [projectData.project_uuid] } }
                ],
                scope_filter_expression_list: []
              },
              {
                entity_filter_expression_list: [
                  { left_hand_side: { entity_type: "container" }, operator: "IN", right_hand_side: { collection: "ALL" } }
                ],
                scope_filter_expression_list: []
              },
              {
                entity_filter_expression_list: [
                  { left_hand_side: { entity_type: "marketplace_item" }, operator: "IN", right_hand_side: { collection: "ALL" } }
                ],
                scope_filter_expression_list: []
              },
              {
                entity_filter_expression_list: [
                  { left_hand_side: { entity_type: "vpc" }, operator: "IN", right_hand_side: { collection: "ALL" } }
                ],
                scope_filter_expression_list: []
              },
              {
                entity_filter_expression_list: [
                  { left_hand_side: { entity_type: "overlay_subnet" }, operator: "IN", right_hand_side: { collection: "ALL" } }
                ],
                scope_filter_expression_list: []
              },
              {
                entity_filter_expression_list: [
                  { left_hand_side: { entity_type: "availability_zone" }, operator: "IN", right_hand_side: { collection: "ALL" } }
                ],
                scope_filter_expression_list: []
              },
              {
                entity_filter_expression_list: [
                  { left_hand_side: { entity_type: "cluster" }, operator: "IN", right_hand_side: { collection: "ALL" } }
                ],
                scope_filter_expression_list: []
              },
              {
                entity_filter_expression_list: [
                  { left_hand_side: { entity_type: "image" }, operator: "IN", right_hand_side: { collection: "ALL" } }
                ],
                scope_filter_expression_list: []
              },
              {
                entity_filter_expression_list: [
                  { left_hand_side: { entity_type: "category" }, operator: "IN", right_hand_side: { collection: "ALL" } }
                ],
                scope_filter_expression_list: []
              },
              {
                entity_filter_expression_list: [
                  { left_hand_side: { entity_type: "ALL" }, operator: "IN", right_hand_side: { collection: "SELF_OWNED" } }
                ],
                scope_filter_expression_list: []
              }
            ]
          }
        }
      }
    };

    const instance = axios.create({
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      auth: { username: process.env.NUTANIX_USER, password: process.env.NUTANIX_PASSWORD },
      headers: { 'Content-Type': 'application/json' }
    });

    const response = await instance.post(
      `https://${process.env.NUTANIX_HOST}:9440/api/nutanix/v3/access_control_policies`,
      payload
    );

    logger.info('ACP created successfully:', response.data);
    return response.data;

  } catch (error) {
    logger.error('Error creating ACP:', { message: error.message, response: error.response?.data || null, stack: error.stack });
    throw error;
  }
}

async function runACP() {
  try {
    const acpResult = await createAccessControlPolicy();
    logger.info('ACP created successfully:', acpResult);
  } catch (err) {
    logger.error('ACP creation failed:', err);
  }
}

// -----------------------------
// API endpoint to create project with ACP
// -----------------------------
app.post('/api/project/create', async (req, res) => {
  try {
    const {size, storageBytes } = req.body;

    if (!size || !storageBytes) {
      return res.status(400).json({ success: false, error: 'Missing required parameters: size and storageBytes are required' });
    }
    if (!cloudSpacePlans[size]) {
      return res.status(400).json({ success: false, error: 'Invalid size. Must be small, medium, or large.' });
    }
    if (!storageOptions[storageBytes]) {
      return res.status(400).json({ success: false, error: 'Invalid storage size.' });
    }

    const planConfig = cloudSpacePlans[size];
    const price = calculatePrice(size, storageBytes);

    let userData;
    try {
      userData = await generateUserData();
      logger.info('Generated user data:', userData);
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to generate user data', details: error.message });
    }

    const result = await createProjectWithUser(planConfig.vcpus, planConfig.memory_gb, storageBytes, userData);

    if (result.success) {
      const configuration = `${planConfig.vcpus} vCPUs, ${planConfig.memory_gb}GB RAM, ${result.configuration.storageDisplay} storage`;
      const dbSuccess = await storeInDatabase(userData.upn, userData.password, configuration, result.projectUrl);

      if (!dbSuccess) {
        logger.warn('Project created but failed to store in database');
      }

      // -----------------------------
      // Automatically create ACP after project creation
      // -----------------------------
      try {
        await runACP();
      } catch (acpError) {
        logger.error('ACP creation failed:', acpError);
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
      res.status(500).json({ success: false, error: 'Failed to create project', details: result.output });
    }
  } catch (error) {
    logger.error('Error creating project:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create project' });
  }
});

// -----------------------------
// Other API endpoints
// -----------------------------
app.get('/api/options', (req, res) => {
  res.json({ plans: cloudSpacePlans, storage: storageOptions });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/payment', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'payment.html'));
});

// -----------------------------
// Graceful shutdown
// -----------------------------
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully');
  if (pool) await pool.end();
  process.exit(0);
});

// -----------------------------
// Start the server
// -----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Morocco Cloud Space app listening on port ${PORT}`);
  logger.info('Available plans:');
  Object.keys(cloudSpacePlans).forEach(plan => {
    logger.info(`- ${plan}: ${cloudSpacePlans[plan].vcpus} vCPUs, ${cloudSpacePlans[plan].memory_gb}GB RAM, ${cloudSpacePlans[plan].price} MAD`);
  });
});

