import os

from calm.dsl.builtins import read_local_file, basic_cred, ahv_vm
from calm.dsl.builtins import Provider, Ref
from calm.dsl.builtins import Substrate, Environment, readiness_probe
from calm.dsl.builtins import AhvVmDisk, AhvVmNic, AhvVmGC, AhvVmResources


NTNX_ACCOUNT_NAME = str(os.environ.get('NTNX_ACCOUNT_NAME'))
NTNX_SUBNET = str(os.environ.get('NTNX_SUBNET'))
NTNX_SUBNET_CLUSTER = str(os.environ.get('NTNX_SUBNET_CLUSTER'))

# Sample file path to hold credentials


class SampleDslEnvironment(Environment):

    providers = [
        Provider.Ntnx(
            account=Ref.Account(NTNX_ACCOUNT_NAME),
            subnets=[
                Ref.Subnet(
                    name=NTNX_SUBNET,
                    cluster=NTNX_SUBNET_CLUSTER,
                )
            ],
        ),
    ]

