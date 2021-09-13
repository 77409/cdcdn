#!/bin/bash


diskValue=$1
# || `  fdisk  -l /dev/sd? |grep "Disk /dev" |awk '{print $2}' | awk -F [：:] '{print $1}'`

# echo "ALL data on $diskValue will be DESTROIED, will you continue to do that   ((N)o/(y)es)?"
#typeset -l answer
#read answer
#if [[ "$answer" =~ ^y(es)? ]]; then
    
#    echo "Please retype (CONFIRM) to continue this operation"
#typeset -l result
#umount /mnt/massdisk
#umount /mnt/massdisk
#umount /mnt/massdisk
#umount ${diskValue}
#umount ${diskValue}
#umount ${diskValue}

#uuid=$(dumpe2fs -h ${diskValue}1 |grep "Filesystem UUID:"|awk -F ": " '{print $2}' | sed 's/^[ \t]*//g')
#umount /mnt/$uuid
#umount /mnt/$uuid
#umount /mnt/$uuid

umount ${diskValue}
umount ${diskValue}1
umount ${diskValue}2
umount ${diskValue}3
umount ${diskValue}4
umount ${diskValue}5

#echo  "value:$svalue"
#read result
#    if [[ "$result" = "confirm" ]]; then

#	    echo " rm 4
#	    y

#	    rm 3
#	    y

#	    rm 2
#	    y

#	    rm 1
#	    y

#	    mklabel gpt
#	    y
#	    unit %

#	    mkpart primary ext4 0% 100%
#	    i
#	    y
#	    mkpart primary ext4 0% 100%
#        y
#        i

#	    quit

#	    "|parted $diskvalue

	    parted -s ${diskValue} mklabel gpt
        parted -s ${diskValue} mkpart primary ext4 0 100%

     echo -e "disk has been created $diskValue"
        sleep 2s
        echo -e "Creating file system now:mkfs.ext4 ${diskValue}1"
        echo "y
       

	"	|mkfs.ext4  ${diskValue}1
     echo -e "disk fs created"
        #create a mount point
        uuid=$(dumpe2fs -h ${diskValue}1 |grep "Filesystem UUID:"|awk -F ": " '{print $2}' | sed 's/^[ \t]*//g')

        if [ ! -d "/mnt/$uuid" ];then
        mkdir -p /mnt/$uuid
        #mkdir -p /mnt/massdisk
        fi

#       mkdir -p /usr/local/cdsc

        #uuid=$(dumpe2fs -h ${diskValue}1 |grep "Filesystem UUID:"|awk -F ": " '{print $2}' | sed 's/^[ \t]*//g')
        echo -e "$uuid" > $(pwd)/diskuuid.txt

         mount -tauto -orw -U $uuid /mnt/$uuid
         mkdir -p /mnt/$uuid/data

         #mount -tauto -orw -U $uuid /mnt/massdisk
         #mkdir -p /mnt/massdisk/data

         #USER=$(whoami)
         #sudo  chown  ${USER}:${USER} -R /mnt/$uuid


#    else 
#        echo "you have denied a dangerous operation"
#    fi
#else 
#   echo "you have denied a dangerous operation"
#fi
