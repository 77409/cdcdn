#!/usr/bin/env bash
diskValue=$1
echo $1
uuid=$(sudo dumpe2fs -h ${diskValue} |grep "Filesystem UUID:"|awk -F ": " '{print $2}' | sed 's/^[ \t]*//g')
USER=$(whoami)
#sudo  chown ${USER}:${USER} -R /mnt/$uuid
sudo  chown  ${USER}:${USER} -R /mnt/$uuid
