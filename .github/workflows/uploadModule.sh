#!/bin/bash

# Upload module to developer.z-wave.me. Run it from userModules folder.
#
# Usage: ./uploadModule.sh <moduleName> <login> <password>

MODULE_ID=$1
MODULE=$2
MODULE_FILENAME=${MODULE}.tar.gz
MAIL=$3
PASSWD=$4
ADMIN=$5

if [ -z "${MODULE}" -o -z "${MAIL}" -o -z "${PASSWD}" ]; then
	echo "Usage: $0 module username password"
	exit 1
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

wget --keep-session-cookies --save-cookies ${COOKIES} --post-data 'mail='"${MAIL}"'&pw='"${PASSWD}" "https://developer.z-wave.me/?uri=login/post" -O /dev/null || exit 2
wget --load-cookies=${COOKIES} --header="Content-type: multipart/form-data boundary=FILEUPLOAD" --post-file ${FORM} "https://developer.z-wave.me/?uri=moduleupload" -O /dev/null || exit 3
wget --load-cookies=${COOKIES} --post-data="id=${MODULE_ID}" "http://developer.z-wave.me/?uri=moduleverify" -O /dev/null || exit 4
if [ -n "${ADMIN}" ]; then
	wget --load-cookies=${COOKIES} --post-data="id=${MODULE_ID}&verifed=1" "http://developer.z-wave.me/?uri=adminmoduleverify" -O /dev/null || exit 5
fi
 
