#!/bin/bash

mntpoint=$(mount -l |grep /dev/mapper/vgeswarm-eswarm |awk '{print $3}')

if [ -z "$mntpoint" ]; then
    if [ ! -d /mnt/eswarm ]; then
        mkdir -p /mnt/eswarm
    fi
        mount /dev/mapper/vgeswarm-eswarm /mnt/eswarm
fi

wtok=$(ls /mnt/eswarm/|grep rawchunks0.wt)

if [ -z "$wtok" ]; then
        rm /mnt/eswarm/WiredTiger*
fi
