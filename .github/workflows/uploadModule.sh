#!/bin/bash

# Upload module to developer.z-wave.me. Run it from userModules folder.
#
# Usage: ./uploadModule.sh <moduleName> <login> <password>

MODULE_ID=$1
MODULE=$2
MODULE_FILENAME=${MODULE}.tar.gz
MAIL=$3
PASSWD=$4

if [ -z "${MODULE}" -o -z "${MAIL}" -o -z "${PASSWD}" ]; then
	echo "Usage: $0 module username password"
	exit
fi

COOKIES=`mktemp`
FILE=`mktemp`
FORM=`mktemp`

(cd "${MODULE}"; tar -zcvf "${FILE}" --exclude=.git *)

cat > ${FORM} <<END
--FILEUPLOAD
Content-Disposition: form-data; name="fileToUpload"; filename="${MODULE_FILENAME}"
Content-Type: application/x-compressed-tar

END
cat ${FILE} >> ${FORM}
cat >> ${FORM} <<END

--FILEUPLOAD--
END

wget --keep-session-cookies --save-cookies ${COOKIES} --post-data 'mail='"${MAIL}"'&pw='"${PASSWD}" https://developer.z-wave.me/?uri=login/post -O /dev/null
wget --load-cookies=${COOKIES} --header="Content-type: multipart/form-data boundary=FILEUPLOAD" --post-file ${FORM} https://developer.z-wave.me/?uri=moduleupload -O /dev/null
wget --load-cookies=${COOKIES} --post="id=${MODULE_ID}" http://developer.z-wave.me/?uri=moduleverify
