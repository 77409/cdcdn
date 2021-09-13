diskValue=$1
echo 'start'
umount $diskValue
umount $diskValue
uuid=$(sudo dumpe2fs -h ${diskValue} |grep "Filesystem UUID:"|awk -F ": " '{print $2}' | sed 's/^[ \t]*//g')
echo $uuid
umount /mnt/$uuid
mkdir -p /mnt/$uuid
mount -tauto -orw -U $uuid /mnt/$uuid
mkdir -p /mnt/$uuid

#USER=$(whoami)
#sudo  chown ${USER}:${USER} -R /mnt/$uuid


#umount $diskValue
#umount $diskValue
#umount /mnt/massdisk
#umount /mnt/massdisk
#umount /mnt/massdisk

#uuid=$(dumpe2fs -h ${diskValue} |grep "Filesystem UUID:"|awk -F ": " '{print $2}' | sed 's/^[ \t]*//g')
##echo "${uuid}" > $(pwd)/diskuuid.txt
#mkdir -p /mnt/massdisk
#mount -tauto -orw -U $uuid /mnt/massdisk
#mkdir -p /mnt/massdisk


