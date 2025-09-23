---
# Prerequisites

- **Nutanix Cluster** with admin credentials
- **Rocky Linux** disk image (tested [Rocky-9-GenericCloud-Base.latest.x86_64.qcow2](https://dl.rockylinux.org/pub/rocky/9.6/images/x86_64/Rocky-9-GenericCloud-Base.latest.x86_64.qcow2))
- **Network** with IPAM-enabled [subnet](https://portal.nutanix.com/page/documents/details?targetId=Prism-Central-Guide-vpc_2024_3_1:mul-network-configuration-view-pc-t.html)  
## Quick Installation


## 1. Provision CMP VM
   - Deploy Rocky Linux 9.6 [ VM ](https://portal.nutanix.com/page/documents/details?targetId=Prism-Central-Guide-vpc_7_3:mul-vm-create-acropolis-pc-t.html) on your Nutanix cluster


## 2. Install Dependencies
```bash
dnf update -y
dnf install vim bash-completion git npm mysql-server ansible-core -y
``` 

- tested versions:
```
git version 2.47.3
npm version 8.19.4
mysqld  version 8.0.41
ansible core version 2.14.18
```



## 3. Setup Ansible
```bash
ansible-galaxy collection install community.general ansible.posix nutanix.ncp ansible.windows
pip3 install "pywinrm>=0.4.0"
pip3 install ntnx-iam-py-client
```

-  tested version:
```
ansible.posix     2.1.0
ansible.windows   3.2.0
community.general 11.3.0
nutanix.ncp       2.2.0
```

## 4. Clone Repository
```bash
git clone https://github.com/barnyhicham18/mcs.git
cd mcs
cp env_simple .env
cp inventory.ini_sample inventory.ini
```


## 6. Install Calm-DSL
```bash
git clone https://github.com/nutanix/calm-dsl.git
cd calm-dsl
sudo dnf install -y python3 python3-devel openssl-devel make gcc openssl python3-pip
sudo pip3 install --upgrade pip setuptools wheel
sudo pip3 install --ignore-installed -r requirements.txt
sudo pip3 install -e .

calm init dsl --ip $NUTANIX_HOST --port 9440 --username $NUTANIX_USER --password $NUTANIX_PASSWORD
```

## 7. Configure Database
```bash
systemctl enable --now mysqld
mysql_secure_installation
mysql -u root -p -e "CREATE DATABASE cloudspace_database;"
```


#### Next Steps
Update these files with your specific values:
- `inventory.ini` - Configure Active Directory connection details
- `.env` - Add your Nutanix credentials and directory service UUID

run `source .env` after you add Nutanix credentials 

- **Get Directory Service UUID** 
    - please make sure you note the Directory Service UUID

```bash
response=$(curl --insecure --request POST \
  --url https://$NUTANIX_HOST:9440/api/nutanix/v3/directory_services/list \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  -u "$NUTANIX_USER:$NUTANIX_PASSWORD" \
  --data '{ "kind": "directory_service"}')

echo $response | jq -r '.entities[0].spec.name' #directory service name
echo $response | jq -r '.entities[0].metadata.uuid' #directory service uuid

#to add the DIRECTORY_SERVICE_UUID variable to .env 
echo "DIRECTORY_SERVICE_UUID=$(echo $response | jq -r '.entities[0].metadata.uuid') " >>  .env 
```
