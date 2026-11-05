package portable

import (
	"bytes"
	"context"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

// These synthetic certificate records exercise boundary parsing only. Real
// Authenticode trust is verified by SignTool in Windows signing acceptance.
func signedFixture(t *testing.T, pe64 bool, padding int, certificates int) ([]byte, Identity, int) {
	t.Helper()
	payload, id := fixture(t, nil, nil)
	header := make([]byte, 512)
	copy(header, "MZ")
	binary.LittleEndian.PutUint32(header[0x3c:], 64)
	copy(header[64:], "PE\x00\x00")
	optionalSize, magic, countOffset, securityOffset := 224, uint16(0x10b), 92, 128
	machine := uint16(0x14c)
	if pe64 {
		optionalSize, magic, countOffset, securityOffset, machine = 240, 0x20b, 108, 144, 0x8664
	}
	binary.LittleEndian.PutUint16(header[68:], machine)
	binary.LittleEndian.PutUint16(header[84:], uint16(optionalSize))
	optional := header[88 : 88+optionalSize]
	binary.LittleEndian.PutUint16(optional, magic)
	binary.LittleEndian.PutUint32(optional[countOffset:], 16)
	// Choose the overlay offset to cover every possible signature alignment.
	for (len(header)+len(payload)+FooterSize+padding)%8 != 0 {
		header = append(header, 0)
	}
	start := len(header)
	result := append(header, payload...)
	footer := make([]byte, FooterSize)
	copy(footer, Magic)
	binary.LittleEndian.PutUint64(footer[16:], uint64(start))
	binary.LittleEndian.PutUint64(footer[24:], uint64(len(payload)))
	result = append(result, footer...)
	result = append(result, make([]byte, padding)...)
	certOffset := len(result)
	for n := 0; n < certificates; n++ {
		record := make([]byte, 16)
		binary.LittleEndian.PutUint32(record, 12)
		binary.LittleEndian.PutUint16(record[4:], 0x200)
		binary.LittleEndian.PutUint16(record[6:], 2)
		copy(record[8:], "test")
		result = append(result, record...)
	}
	directory := 88 + securityOffset
	binary.LittleEndian.PutUint32(result[directory:], uint32(certOffset))
	binary.LittleEndian.PutUint32(result[directory+4:], uint32(16*certificates))
	return result, id, certOffset
}

func readFixturePayload(t *testing.T, data []byte, id Identity) error {
	t.Helper()
	name := filepath.Join(t.TempDir(), "setup.exe")
	if err := os.WriteFile(name, data, 0600); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	payload, err := Payload(f, id.Bytes)
	if err != nil {
		return err
	}
	return Verify(context.Background(), payload, id, nil)
}

func TestAuthenticodePayloadAlignmentAndMultipleCertificates(t *testing.T) {
	for _, pe64 := range []bool{false, true} {
		for padding := 0; padding < 8; padding++ {
			for _, count := range []int{1, 2} {
				data, id, _ := signedFixture(t, pe64, padding, count)
				if err := readFixturePayload(t, data, id); err != nil {
					t.Fatalf("PE64=%v padding=%d certs=%d: %v", pe64, padding, count, err)
				}
			}
		}
	}
}

func TestAuthenticodePayloadRejectsMalformedBoundaries(t *testing.T) {
	for _, name := range []string{"trailing", "unaligned", "oversized-table", "short-record", "oversized-record", "wrong-revision", "wrong-type", "nonzero-padding", "nonzero-record-padding", "damaged-payload"} {
		t.Run(name, func(t *testing.T) {
			data, id, offset := signedFixture(t, true, 3, 1)
			switch name {
			case "trailing":
				data = append(data, 0)
			case "unaligned":
				binary.LittleEndian.PutUint32(data[88+144:], uint32(offset-1))
			case "oversized-table":
				binary.LittleEndian.PutUint32(data[88+148:], 0xffffffff)
			case "short-record":
				binary.LittleEndian.PutUint32(data[offset:], 8)
			case "oversized-record":
				binary.LittleEndian.PutUint32(data[offset:], 0xffffffff)
			case "wrong-revision":
				binary.LittleEndian.PutUint16(data[offset+4:], 0x100)
			case "wrong-type":
				binary.LittleEndian.PutUint16(data[offset+6:], 1)
			case "nonzero-padding":
				data[offset-1] = 1
			case "nonzero-record-padding":
				data[len(data)-1] = 1
			case "damaged-payload":
				data[bytes.Index(data, []byte("PK\x03\x04"))] ^= 1
			}
			if err := readFixturePayload(t, data, id); err == nil {
				t.Fatal("accepted malformed signed fixture")
			}
		})
	}
}
