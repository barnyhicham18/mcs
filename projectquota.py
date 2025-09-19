
import os

from calm.dsl.builtins import Project


VCPUS = int(os.environ.get('VCPUS'))
STORAGE = int(os.environ.get('STORAGE' ))
MEMORY = int(os.environ.get('MEMORY'))


#
#VCPUS = os.getenv('VCPUS')
#STORAGE = os.getenv ('STORAGE')
#MEMORY = os.getenv('MEMORY')


class TestDslDemoProject(Project):
    quotas = {"vcpus": VCPUS, "storage": STORAGE, "memory": MEMORY}
