
## Prerequisites

- **Nutanix Cluster** with admin credentials
- **Rocky Linux 9.6** VM image (tested)
- **Network** with IPAM-enabled subnet
- **VM Resources**: 2 vCPUs, 4GB RAM, 40GB storage

## Quick Installation

1. **Provision CMP VM**
   - Deploy Rocky Linux 9.6 VM on Nutanix
   - Connect to network with IPAM

2. **Install Dependencies**
```bash
dnf update -y
dnf install vim bash-completion git npm mysql-server ansible-core -y
npm install  pm2 -g
ansible-galaxy collection install community.general
ansible-galaxy collection install ansible.posix
ansible-galaxy collection install nutanix.ncp
systemctl enable mysqld --now
mysql_secure_installation
```

3. **Deploy Application**
```bash
git clone https://github.com/elyacoub9/node-ansible-cmp.git
cd node-ansible-cmp
cp env_simple .env    # Configure .env with your credentials
npm install
sudo npm install pm2 -g
```

4. **Database Setup**
```bash
mysql -u root -p -e "CREATE DATABASE vps_app;"
```

5. **Start Service**
```bash
pm2 start vmcreator.js
pm2 startup
```


## Access

Application available at: `http://cmp-server-ip:3000`

TODO:

- [ ] create cPanel template 

# cloudspace
